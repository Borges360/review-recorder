export interface RelativeSegment {
  text: string;
  startMs: number;
  endMs: number;
}

export const FAKE_CHUNK_TEXT = 'comentário sobre a tela';

export function shiftChunkSegments(segments: RelativeSegment[], chunkStartMs: number): RelativeSegment[] {
  return segments
    .filter((segment) => segment.text.trim().length > 0)
    .map((segment) => ({
      text: segment.text.trim(),
      startMs: chunkStartMs + segment.startMs,
      endMs: chunkStartMs + Math.max(segment.endMs, segment.startMs),
    }));
}

export function parseTranscriptPayload(
  data: { text?: string; segments?: { text?: string; start?: number; end?: number }[] },
  durationMs: number,
): RelativeSegment[] {
  const segments = data.segments?.filter((segment) => segment.text?.trim()) ?? [];
  if (segments.length > 0) {
    return segments.map((segment) => ({
      text: segment.text!.trim(),
      startMs: Math.round((segment.start ?? 0) * 1000),
      endMs: Math.round((segment.end ?? (segment.start ?? 0)) * 1000),
    }));
  }
  if (data.text?.trim()) {
    return [{ text: data.text.trim(), startMs: 0, endMs: Math.max(durationMs, 1) }];
  }
  return [];
}

export function fakeChunkSegments(durationMs: number): RelativeSegment[] {
  return [{ text: FAKE_CHUNK_TEXT, startMs: 0, endMs: Math.max(durationMs, 1) }];
}
