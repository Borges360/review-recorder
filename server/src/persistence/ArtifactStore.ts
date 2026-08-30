import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class ArtifactStore {
  constructor(private readonly sessionDir: string) {
    for (const sub of ['raw', 'evidence']) {
      const p = join(sessionDir, sub);
      if (!existsSync(p)) mkdirSync(p, { recursive: true });
    }
  }

  getSessionDir(): string {
    return this.sessionDir;
  }

  getRawDir(): string {
    return join(this.sessionDir, 'raw');
  }

  getEvidenceDir(): string {
    return join(this.sessionDir, 'evidence');
  }

  getScreenshotPath(name: string): string {
    return join(this.sessionDir, 'evidence', name);
  }

  getScreenshotRelative(name: string): string {
    return `evidence/${name}`;
  }

  getAudioPath(): string {
    return join(this.sessionDir, 'raw', 'audio.wav');
  }

  getTranscriptPath(): string {
    return join(this.sessionDir, 'raw', 'transcript.jsonl');
  }

  getReviewJsonPath(): string {
    return join(this.sessionDir, 'review.json');
  }

  getReviewMdPath(): string {
    return join(this.sessionDir, 'REVIEW.md');
  }
}
