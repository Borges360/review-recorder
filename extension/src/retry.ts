export function nextRetryDelayMs(attempts: number): number {
  return Math.min(30_000, 1000 * 2 ** attempts);
}
