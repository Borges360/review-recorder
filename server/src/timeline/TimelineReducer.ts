import type { TimelineEntry } from '../shared/types.js';

/** Reduces raw timeline entries by merging adjacent duplicates. */
export class TimelineReducer {
  reduce(entries: TimelineEntry[]): TimelineEntry[] {
    const result: TimelineEntry[] = [];
    for (const entry of entries) {
      const prev = result[result.length - 1];
      if (
        prev &&
        entry.type === 'action' &&
        prev.type === 'action' &&
        entry.action === prev.action
      ) {
        continue;
      }
      result.push(entry);
    }
    return result;
  }
}
