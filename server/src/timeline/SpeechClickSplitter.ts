import type {
  AssociationConfidence,
  ElementIdentity,
  ObservationScope,
} from '../shared/types.js';
import { splitTextByTimeIntervals } from './CorrelationEngine.js';

export interface ScreenSnapshot {
  id: string;
  url: string;
  title: string;
}

export interface ClickSplitPoint {
  atMs: number;
  target: ElementIdentity | null;
  screen: ScreenSnapshot;
}

export interface SplitObservationChunk {
  startedAtMs: number;
  endedAtMs: number;
  text: string;
  screen: ScreenSnapshot;
  scope: ObservationScope;
  candidateElement: ElementIdentity | null;
  associationConfidence: AssociationConfidence;
}

/** Minimum clicks required to split a monologue (1 click → 2 speech blocks). */
export const MIN_CLICKS_TO_SPLIT = 1;

/**
 * Split a transcript monologue across click timestamps (time-proportional, word-safe).
 * Used at compile time from events.jsonl and at runtime when OpenAI sends no partial deltas.
 */
export function splitTranscriptByClickTimes(
  text: string,
  startedAtMs: number,
  endedAtMs: number,
  clicks: ClickSplitPoint[],
  startScreen: ScreenSnapshot,
): SplitObservationChunk[] {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return [];

  const sorted = [...clicks]
    .filter((c) => c.atMs > startedAtMs && c.atMs < endedAtMs)
    .sort((a, b) => a.atMs - b.atMs);

  if (sorted.length < MIN_CLICKS_TO_SPLIT) {
    return [
      {
        startedAtMs,
        endedAtMs,
        text: normalized,
        screen: startScreen,
        scope: 'SCREEN',
        candidateElement: null,
        associationConfidence: 'LOW',
      },
    ];
  }

  type Interval = {
    startMs: number;
    endMs: number;
    screen: ScreenSnapshot;
    target: ElementIdentity | null;
  };

  const intervals: Interval[] = [
    { startMs: startedAtMs, endMs: sorted[0]!.atMs, screen: startScreen, target: null },
  ];
  for (let i = 0; i < sorted.length - 1; i++) {
    intervals.push({
      startMs: sorted[i]!.atMs,
      endMs: sorted[i + 1]!.atMs,
      screen: sorted[i]!.screen,
      target: sorted[i]!.target,
    });
  }
  intervals.push({
    startMs: sorted[sorted.length - 1]!.atMs,
    endMs: endedAtMs,
    screen: sorted[sorted.length - 1]!.screen,
    target: sorted[sorted.length - 1]!.target,
  });

  const speechIntervals = intervals.map((iv) => ({
    startMs: iv.startMs,
    endMs: iv.endMs,
    context: {
      screenStateId: iv.screen.id || null,
      pageId: null,
      lastActionId: null,
      lastActionTarget: iv.target,
      lastActionAtMs: iv.startMs,
    },
  }));

  const textParts = splitTextByTimeIntervals(normalized, speechIntervals);
  const chunks: SplitObservationChunk[] = [];

  for (let i = 0; i < intervals.length; i++) {
    const chunkText = textParts[i]?.trim();
    if (!chunkText) continue;
    const iv = intervals[i]!;
    const hasElement = !!iv.target;
    chunks.push({
      startedAtMs: iv.startMs,
      endedAtMs: iv.endMs,
      text: chunkText,
      screen: iv.screen,
      scope: hasElement ? 'ELEMENT' : 'SCREEN',
      candidateElement: iv.target,
      associationConfidence: hasElement ? 'HIGH' : 'LOW',
    });
  }

  if (chunks.length === 0) {
    return [
      {
        startedAtMs,
        endedAtMs,
        text: normalized,
        screen: startScreen,
        scope: 'SCREEN',
        candidateElement: null,
        associationConfidence: 'LOW',
      },
    ];
  }

  return chunks;
}
