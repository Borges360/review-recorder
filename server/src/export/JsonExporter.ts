import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReviewPackage } from '../shared/types.js';

export class JsonExporter {
  constructor(private readonly sessionDir: string) {}

  export(review: ReviewPackage): void {
    writeFileSync(join(this.sessionDir, 'review.json'), JSON.stringify(review, null, 2), 'utf8');
  }
}
