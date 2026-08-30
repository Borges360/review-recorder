import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionClock } from '../../src/session/SessionClock.js';

describe('SessionClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks active elapsed excluding pause', () => {
    const clock = new SessionClock(new Date('2026-08-30T14:00:00Z'));
    vi.advanceTimersByTime(5000);
    expect(clock.activeElapsedMs()).toBeGreaterThanOrEqual(0);

    clock.pause();
    vi.advanceTimersByTime(10000);
    const activeDuringPause = clock.activeElapsedMs();

    clock.resume();
    vi.advanceTimersByTime(3000);
    expect(clock.activeElapsedMs()).toBeGreaterThan(activeDuringPause);
    expect(clock.isPaused()).toBe(false);
  });

  it('wall elapsed includes pause time', () => {
    const start = new Date('2026-08-30T14:00:00.000Z');
    vi.setSystemTime(start);
    const clock = new SessionClock(start);
    vi.advanceTimersByTime(5000);
    clock.pause();
    vi.advanceTimersByTime(10000);
    expect(clock.wallElapsedMs()).toBeGreaterThanOrEqual(15000);
  });
});
