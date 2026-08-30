import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { WriteStream } from 'node:fs';
import type { EventEnvelope } from '../shared/types.js';

export class EventStore {
  private stream: WriteStream | null = null;
  private sequence = 0;
  private readonly filePath: string;

  constructor(sessionDir: string) {
    const rawDir = join(sessionDir, 'raw');
    if (!existsSync(rawDir)) mkdirSync(rawDir, { recursive: true });
    this.filePath = join(rawDir, 'events.jsonl');
  }

  open(): void {
    if (this.stream) return;
    this.stream = createWriteStream(this.filePath, { flags: 'a' });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.stream) {
        resolve();
        return;
      }
      this.stream.end(() => {
        this.stream = null;
        resolve();
      });
      this.stream.on('error', reject);
    });
  }

  getEventsPath(): string {
    return this.filePath;
  }

  append(event: Omit<EventEnvelope, 'sequence'> & { sequence?: number }): EventEnvelope {
    if (!this.stream) this.open();
    const full: EventEnvelope = {
      ...event,
      sequence: event.sequence ?? ++this.sequence,
    };
    const line = JSON.stringify(full) + '\n';
    this.stream!.write(line);
    if (this.isCritical(full.type)) {
      this.stream!.write('', () => {});
    }
    return full;
  }

  setSequenceFromRecovery(lastSequence: number): void {
    this.sequence = lastSequence;
  }

  private isCritical(type: string): boolean {
    return [
      'SESSION_STARTED',
      'SESSION_PAUSED',
      'SESSION_RESUMED',
      'SESSION_STOPPED',
      'SCREENSHOT_CAPTURED',
      'TRANSCRIPT_FINAL',
      'SCREEN_STATE_CREATED',
    ].includes(type);
  }
}
