import { randomUUID } from 'node:crypto';
import type {
  ElementIdentity,
  AssociationConfidence,
  ObservationScope,
  TranscriptSegmentRecord,
} from '../shared/types.js';
import {
  splitTranscriptByClickTimes,
  type ClickSplitPoint,
  type ScreenSnapshot,
} from './SpeechClickSplitter.js';

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
  /** Context captured when this speech segment started (before any click in this span). */
  startContext: SpeechContext;
  context: SpeechContext;
  partialText: string;
}

export interface ClickBoundary {
  atMs: number;
  context: SpeechContext;
}

interface SpeechInterval {
  startMs: number;
  endMs: number;
  context: SpeechContext;
}

/** Snap a character index to the nearest word boundary (space). */
export function snapToWordBoundary(text: string, pos: number): number {
  if (pos <= 0) return 0;
  if (pos >= text.length) return text.length;
  const before = text.lastIndexOf(' ', pos);
  const after = text.indexOf(' ', pos);
  if (before === -1 && after === -1) return pos;
  if (before === -1) return after;
  if (after === -1) return before;
  return pos - before <= after - pos ? before : after;
}

/** Split transcript text across time intervals, snapping cuts to word boundaries. */
export function splitTextByTimeIntervals(
  text: string,
  intervals: SpeechInterval[],
): string[] {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized || intervals.length === 0) return normalized ? [normalized] : [];

  const totalMs = intervals[intervals.length - 1]!.endMs - intervals[0]!.startMs;
  if (totalMs <= 0) return [normalized];

  const len = normalized.length;
  const cuts: number[] = [0];
  const baseMs = intervals[0]!.startMs;

  for (let i = 0; i < intervals.length - 1; i++) {
    const endMs = intervals[i]!.endMs;
    const ratio = (endMs - baseMs) / totalMs;
    let pos = Math.round(ratio * len);
    pos = snapToWordBoundary(normalized, pos);
    if (pos <= cuts[cuts.length - 1]!) {
      pos = normalized.indexOf(' ', cuts[cuts.length - 1]! + 1);
      if (pos === -1) pos = len;
    }
    cuts.push(Math.min(pos, len));
  }
  cuts.push(len);

  const parts: string[] = [];
  for (let i = 0; i < intervals.length; i++) {
    const chunk = normalized.slice(cuts[i], cuts[i + 1]).trim();
    if (chunk) parts.push(chunk);
    else parts.push('');
  }
  return parts;
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

export interface FinalizeSpeechOptions {
  clickPoints?: ClickSplitPoint[];
  speechStartMs?: number;
  startScreen?: ScreenSnapshot;
}

export class TranscriptAssembler {
  private active: ActiveSpeech | null = null;
  private segmentCounter = 0;
  /** Prefix already persisted via click-triggered flushes (used to reconcile onFinal). */
  private emittedText = '';
  /** Click timestamps recorded when partial text was unavailable (OpenAI sends deltas late). */
  private clickBoundaries: ClickBoundary[] = [];

  startSpeech(itemId: string, startedAtMs: number, context: SpeechContext): ActiveSpeech {
    this.active = {
      id: `speech-${++this.segmentCounter}`,
      itemId,
      startedAtMs,
      startContext: { ...context },
      context: { ...context },
      partialText: '',
    };
    this.clickBoundaries = [];
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
      startContext: { ...newContext },
      context: { ...newContext },
      partialText: remainder,
    };

    return segment;
  }

  /** Record a click during active speech when partial transcript is not yet available. */
  recordClickBoundary(atMs: number, postClickContext: SpeechContext): void {
    if (!this.active) return;
    this.clickBoundaries.push({ atMs, context: { ...postClickContext } });
  }

  /** Finalize only the portion of fullText not already emitted via click flushes. */
  finalizeFromFullText(
    fullText: string,
    itemId: string,
    endedAtMs: number,
    sessionId: string,
    external?: FinalizeSpeechOptions,
  ): { segments: TranscriptSegmentRecord[]; wasActive: ActiveSpeech | null } {
    const wasActive = this.active;
    const speech = this.active?.itemId === itemId ? this.active : this.active;

    let textToSplit = fullText.trim().replace(/\s+/g, ' ');
    if (!textToSplit) {
      this.active = null;
      this.emittedText = '';
      this.clickBoundaries = [];
      return { segments: [], wasActive };
    }

    if (this.emittedText) {
      textToSplit = this.extractRemainder(fullText);
      this.clickBoundaries = [];
    }

    if (this.clickBoundaries.length > 0 && textToSplit && speech) {
      const segments = this.buildSegmentsFromBoundaries(
        textToSplit,
        speech,
        endedAtMs,
        sessionId,
        itemId,
      );
      this.clickBoundaries = [];
      this.emittedText = '';
      this.active = null;
      return { segments, wasActive };
    }

    const clickPoints = external?.clickPoints ?? [];
    const speechStartMs = speech?.startedAtMs ?? external?.speechStartMs ?? 0;
    const startScreen = external?.startScreen ?? {
      id: speech?.startContext.screenStateId ?? '',
      url: '',
      title: '',
    };

    if (clickPoints.length > 0) {
      const chunks = splitTranscriptByClickTimes(
        textToSplit,
        speechStartMs,
        endedAtMs,
        clickPoints,
        startScreen,
      );
      const segments = chunks.map((chunk) => this.chunkToSegment(chunk, sessionId, itemId));
      this.emittedText = '';
      this.clickBoundaries = [];
      this.active = null;
      return { segments, wasActive };
    }

    this.emittedText = '';
    if (!speech) {
      return { segments: [], wasActive: null };
    }

    const { segment } = this.finalize(textToSplit, itemId, endedAtMs, sessionId);
    return { segments: [segment], wasActive };
  }

  private chunkToSegment(
    chunk: {
      startedAtMs: number;
      endedAtMs: number;
      text: string;
      screen: ScreenSnapshot;
      scope: ObservationScope;
      candidateElement: ElementIdentity | null;
      associationConfidence: AssociationConfidence;
    },
    sessionId: string,
    itemId: string,
  ): TranscriptSegmentRecord {
    return {
      id: `speech-${++this.segmentCounter}`,
      sessionId,
      itemId,
      text: chunk.text,
      startedAtMs: chunk.startedAtMs,
      endedAtMs: chunk.endedAtMs,
      screenStateId: chunk.screen.id || null,
      pageId: null,
      lastActionId: null,
      scope: chunk.scope,
      candidateElement: chunk.candidateElement,
      associationConfidence: chunk.associationConfidence,
    };
  }

  private buildSegmentsFromBoundaries(
    text: string,
    speech: ActiveSpeech,
    endedAtMs: number,
    sessionId: string,
    itemId: string,
  ): TranscriptSegmentRecord[] {
    const boundaries = [...this.clickBoundaries].sort((a, b) => a.atMs - b.atMs);
    const intervals: SpeechInterval[] = [
      {
        startMs: speech.startedAtMs,
        endMs: boundaries[0]!.atMs,
        context: speech.startContext,
      },
    ];
    for (let i = 0; i < boundaries.length - 1; i++) {
      intervals.push({
        startMs: boundaries[i]!.atMs,
        endMs: boundaries[i + 1]!.atMs,
        context: boundaries[i]!.context,
      });
    }
    intervals.push({
      startMs: boundaries[boundaries.length - 1]!.atMs,
      endMs: endedAtMs,
      context: boundaries[boundaries.length - 1]!.context,
    });

    const textParts = splitTextByTimeIntervals(text, intervals);
    const segments: TranscriptSegmentRecord[] = [];

    for (let i = 0; i < intervals.length; i++) {
      const chunk = textParts[i]?.trim();
      if (!chunk) continue;
      segments.push(
        this.buildSegment(
          chunk,
          intervals[i]!.startMs,
          intervals[i]!.endMs,
          intervals[i]!.context,
          sessionId,
          itemId,
          `speech-${++this.segmentCounter}`,
          intervals[i]!.startMs,
        ),
      );
    }

    return segments;
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
    scopeAtMs: number = endedAtMs,
  ): TranscriptSegmentRecord {
    const { scope, confidence, candidate } = this.inferScope(ctx, scopeAtMs);
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
