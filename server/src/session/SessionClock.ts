export class SessionClock {
  private readonly startedAtWall: Date;
  private readonly startedAtMono: bigint;
  private pausedAtMono: bigint | null = null;
  private totalPausedNs = 0n;

  constructor(startedAtWall?: Date) {
    this.startedAtWall = startedAtWall ?? new Date();
    this.startedAtMono = process.hrtime.bigint();
  }

  get startedAt(): Date {
    return this.startedAtWall;
  }

  get startedAtIso(): string {
    return this.startedAtWall.toISOString();
  }

  pause(): void {
    if (this.pausedAtMono !== null) return;
    this.pausedAtMono = process.hrtime.bigint();
  }

  resume(): void {
    if (this.pausedAtMono === null) return;
    this.totalPausedNs += process.hrtime.bigint() - this.pausedAtMono;
    this.pausedAtMono = null;
  }

  isPaused(): boolean {
    return this.pausedAtMono !== null;
  }

  elapsedMs(): number {
    const now = process.hrtime.bigint();
    const pausedExtra =
      this.pausedAtMono !== null ? now - this.pausedAtMono : 0n;
    const activeNs = now - this.startedAtMono - this.totalPausedNs - pausedExtra;
    return Number(activeNs / 1_000_000n);
  }

  wallElapsedMs(): number {
    return Date.now() - this.startedAtWall.getTime();
  }

  activeElapsedMs(): number {
    return this.elapsedMs();
  }
}
