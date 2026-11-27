import { describe, it, expect } from 'vitest';
import { splitTranscriptByClickTimes } from '../../src/timeline/SpeechClickSplitter.js';

describe('splitTranscriptByClickTimes', () => {
  const startScreen = { id: 's0', url: 'http://localhost/', title: 'Dashboard' };

  it('returns single chunk when no clicks in speech window', () => {
    const chunks = splitTranscriptByClickTimes(
      'texto único aqui',
      0,
      10000,
      [],
      startScreen,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe('texto único aqui');
  });

  it('splits monologue across multiple clicks without losing words', () => {
    const text =
      'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau';
    const clicks = [
      { atMs: 10000, target: null, screen: { id: 's1', url: '/a', title: 'A' } },
      { atMs: 20000, target: null, screen: { id: 's2', url: '/b', title: 'B' } },
      { atMs: 30000, target: null, screen: { id: 's3', url: '/c', title: 'C' } },
    ];
    const chunks = splitTranscriptByClickTimes(text, 0, 40000, clicks, startScreen);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.text).join(' ')).toBe(text);
    expect(chunks[0]?.startedAtMs).toBe(0);
    expect(chunks[1]?.startedAtMs).toBe(10000);
  });
});
