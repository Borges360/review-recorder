import { randomUUID } from 'node:crypto';
import type {
  ElementIdentity,
  AssociationConfidence,
  ObservationScope,
  TranscriptSegmentRecord,
} from '../shared/types.js';

export interface SpeechContext {
  screenStateId: string | null;
  pageId: string | null;
  lastActionId: string | null;
  lastActionTarget: ElementIdentity | null;
  lastActionAtMs: number;
}

export interface ActiveSpeech {
  id: string;
  itemId: string;
  startedAtMs: number;
  context: SpeechContext;
  partialText: string;
}

/** Split text at word boundaries; keeps the last token if still in progress (no trailing space). */
export function splitAtWordBoundary(text: string): { complete: string; remainder: string } {
  if (text.endsWith(' ')) {
    return { complete: text.trimEnd(), remainder: '' };
  }
  const trimmed = text.trimEnd();
  if (!trimmed) return { complete: '', remainder: '' };
  const tokens = trimmed.split(/\s+/);
  if (tokens.length <= 2) {
    return { complete: '', remainder: trimmed };
  }
  return {
    complete: tokens.slice(0, -1).join(' '),
    remainder: tokens[tokens.length - 1]!,
  };
}

export class TranscriptAssembler {
  private active: ActiveSpeech | null = null;
  private segmentCounter = 0;
  /** Prefix already persisted via click-triggered flushes (used to reconcile onFinal). */
  private emittedText = '';

  startSpeech(itemId: string, startedAtMs: number, context: SpeechContext): ActiveSpeech {
    this.active = {
      id: `speech-${++this.segmentCounter}`,
      itemId,
      startedAtMs,
      context: { ...context },
      partialText: '',
    };
    return this.active;
  }

  updatePartial(text: string, itemId: string): string {
    if (!this.active || this.active.itemId !== itemId) return text;
    this.active.partialText = text;
    return this.active.partialText;
  }

  appendPartial(delta: string, itemId: string): string {
    if (!this.active || this.active.itemId !== itemId) return delta;
    this.active.partialText += delta;
    return this.active.partialText;
  }

  finalize(
    text: string,
    itemId: string,
    endedAtMs: number,
    sessionId: string,
  ): { segment: TranscriptSegmentRecord; wasActive: ActiveSpeech | null } {
    const speech = this.active?.itemId === itemId ? this.active : this.active;
    const ctx = speech?.context ?? {
      screenStateId: null,
      pageId: null,
      lastActionId: null,
      lastActionTarget: null,
      lastActionAtMs: 0,
    };
    const startedAtMs = speech?.startedAtMs ?? endedAtMs;
    const segment = this.buildSegment(
      text.trim(),
      startedAtMs,
      endedAtMs,
      ctx,
      sessionId,
      itemId,
      speech?.id,
    );

    const wasActive = this.active;
    if (this.active?.itemId === itemId) this.active = null;
    return { segment, wasActive };
  }

  /** Flush speech at click boundary; returns segment or null if no complete words yet. */
  flushAtClick(
    endedAtMs: number,
    sessionId: string,
    newContext: SpeechContext,
  ): TranscriptSegmentRecord | null {
    if (!this.active) return null;

    const { complete, remainder } = splitAtWordBoundary(this.active.partialText);
    if (!complete.trim()) return null;

    const segment = this.buildSegment(
      complete.trim(),
      this.active.startedAtMs,
      endedAtMs,
      this.active.context,
      sessionId,
      this.active.itemId,
      this.active.id,
    );

    this.emittedText = this.emittedText
      ? `${this.emittedText} ${complete.trim()}`
      : complete.trim();

    const itemId = this.active.itemId;
    this.active = {
      id: `speech-${++this.segmentCounter}`,
      itemId,
      startedAtMs: endedAtMs,
      context: { ...newContext },
      partialText: remainder,
    };

    return segment;
  }

  /** Finalize only the portion of fullText not already emitted via click flushes. */
  finalizeFromFullText(
    fullText: string,
    itemId: string,
    endedAtMs: number,
    sessionId: string,
  ): { segment: TranscriptSegmentRecord | null; wasActive: ActiveSpeech | null } {
    const remainder = this.extractRemainder(fullText);
    const wasActive = this.active;
    this.emittedText = '';

    if (!remainder.trim()) {
      if (this.active?.itemId === itemId) this.active = null;
      return { segment: null, wasActive };
    }

    return this.finalize(remainder, itemId, endedAtMs, sessionId);
  }

  getActive(): ActiveSpeech | null {
    return this.active;
  }

  private extractRemainder(fullText: string): string {
    const normalizedFull = fullText.trim().replace(/\s+/g, ' ');
    if (!this.emittedText) return normalizedFull;

    const normalizedEmitted = this.emittedText.trim().replace(/\s+/g, ' ');
    if (normalizedFull.startsWith(normalizedEmitted)) {
      return normalizedFull.slice(normalizedEmitted.length).trim();
    }

    // Partial flushes may differ slightly from final transcript — fall back to active partial.
    if (this.active?.partialText.trim()) {
      const partial = this.active.partialText.trim().replace(/\s+/g, ' ');
      if (normalizedFull.endsWith(partial)) {
        return partial;
      }
    }

    return normalizedFull;
  }

  private buildSegment(
    text: string,
    startedAtMs: number,
    endedAtMs: number,
    ctx: SpeechContext,
    sessionId: string,
    itemId: string,
    speechId?: string,
  ): TranscriptSegmentRecord {
    const { scope, confidence, candidate } = this.inferScope(ctx, endedAtMs);
    return {
      id: speechId ?? `speech-${++this.segmentCounter}`,
      sessionId,
      itemId,
      text,
      startedAtMs,
      endedAtMs,
      screenStateId: ctx.screenStateId,
      pageId: ctx.pageId,
      lastActionId: ctx.lastActionId,
      scope,
      candidateElement: candidate,
      associationConfidence: confidence,
    };
  }

  private inferScope(
    ctx: SpeechContext,
    nowMs: number,
  ): {
    scope: ObservationScope;
    confidence: AssociationConfidence;
    candidate: ElementIdentity | null;
  } {
    if (!ctx.lastActionTarget || !ctx.lastActionAtMs) {
      return { scope: 'SCREEN', confidence: 'LOW', candidate: null };
    }
    const delta = nowMs - ctx.lastActionAtMs;
    if (delta <= 3000) {
      return { scope: 'ELEMENT', confidence: 'HIGH', candidate: ctx.lastActionTarget };
    }
    if (delta <= 8000) {
      return { scope: 'ELEMENT', confidence: 'MEDIUM', candidate: ctx.lastActionTarget };
    }
    return { scope: 'SCREEN', confidence: 'LOW', candidate: null };
  }
}

export class CorrelationEngine {
  currentPageId: string | null = null;
  currentScreenStateId: string | null = null;
  lastRelevantActionId: string | null = null;
  lastRelevantActionTarget: ElementIdentity | null = null;
  lastRelevantActionAtMs = 0;
  actionCounter = 0;
  screenStateCounter = 0;

  pendingEvidence: { id: string; createdAtMs: number } | null = null;

  updatePage(pageId: string): void {
    this.currentPageId = pageId;
  }

  updateScreenState(stateId: string): void {
    this.currentScreenStateId = stateId;
  }

  recordAction(target: ElementIdentity | null, atMs: number): string {
    const id = `action-${++this.actionCounter}`;
    this.lastRelevantActionId = id;
    this.lastRelevantActionTarget = target;
    this.lastRelevantActionAtMs = atMs;
    return id;
  }

  getSpeechContext(): SpeechContext {
    return {
      screenStateId: this.currentScreenStateId,
      pageId: this.currentPageId,
      lastActionId: this.lastRelevantActionId,
      lastActionTarget: this.lastRelevantActionTarget,
      lastActionAtMs: this.lastRelevantActionAtMs,
    };
  }

  registerPendingEvidence(id: string, atMs: number): void {
    this.pendingEvidence = { id, createdAtMs: atMs };
  }

  consumePendingEvidence(withinMs = 2000, nowMs: number): string | null {
    if (!this.pendingEvidence) return null;
    if (nowMs - this.pendingEvidence.createdAtMs <= withinMs) {
      const id = this.pendingEvidence.id;
      this.pendingEvidence = null;
      return id;
    }
    if (nowMs - this.pendingEvidence.createdAtMs > withinMs * 2) {
      this.pendingEvidence = null;
    }
    return null;
  }

  reset(): void {
    this.currentPageId = null;
    this.currentScreenStateId = null;
    this.lastRelevantActionId = null;
    this.lastRelevantActionTarget = null;
    this.lastRelevantActionAtMs = 0;
    this.pendingEvidence = null;
  }
}

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
