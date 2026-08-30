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

export class TranscriptAssembler {
  private active: ActiveSpeech | null = null;
  private segmentCounter = 0;

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
    const { scope, confidence, candidate } = this.inferScope(ctx, endedAtMs);

    const segment: TranscriptSegmentRecord = {
      id: speech?.id ?? `speech-${++this.segmentCounter}`,
      sessionId,
      itemId,
      text: text.trim(),
      startedAtMs,
      endedAtMs,
      screenStateId: ctx.screenStateId,
      pageId: ctx.pageId,
      lastActionId: ctx.lastActionId,
      scope,
      candidateElement: candidate,
      associationConfidence: confidence,
    };

    const wasActive = this.active;
    if (this.active?.itemId === itemId) this.active = null;
    return { segment, wasActive };
  }

  getActive(): ActiveSpeech | null {
    return this.active;
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
