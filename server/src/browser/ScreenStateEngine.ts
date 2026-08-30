import { createHash } from 'node:crypto';
import type { Page } from 'playwright';
import {
  redactAriaSnapshot,
  normalizeRoute,
  normalizeAriaLines,
  jaccardSimilarity,
} from '../shared/redaction.js';

export interface CapturedScreenState {
  fingerprint: string;
  url: string;
  normalizedRoute: string;
  title: string;
  ariaSnapshot: string;
  dialogs: string[];
  isNew: boolean;
}

export class AriaSnapshotService {
  async capture(page: Page): Promise<{ raw: string; normalized: string; title: string; dialogs: string[] }> {
    let raw = '';
    try {
      raw = await page.locator('body').ariaSnapshot({ timeout: 3000 });
    } catch {
      raw = '- document';
    }
    if (raw.length > 50000) {
      raw = raw.slice(0, 50000) + '\n... [truncated]';
    }
    const normalized = redactAriaSnapshot(raw);
    const title = await this.deriveTitle(page, normalized);
    const dialogs = this.extractDialogs(normalized);
    return { raw, normalized, title, dialogs };
  }

  private async deriveTitle(page: Page, aria: string): Promise<string> {
    const dialogMatch = aria.match(/dialog[^"]*"([^"]+)"/i);
    if (dialogMatch) return dialogMatch[1];
    const headingMatch = aria.match(/heading[^"]*"([^"]+)"/i);
    if (headingMatch) return headingMatch[1];
    try {
      return (await page.title()) || 'Untitled';
    } catch {
      return 'Untitled';
    }
  }

  private extractDialogs(aria: string): string[] {
    const dialogs: string[] = [];
    const regex = /dialog[^"]*"([^"]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(aria)) !== null) {
      dialogs.push(m[1]);
    }
    return dialogs;
  }
}

export class ScreenStateEngine {
  private currentFingerprint: string | null = null;
  private currentLines: string[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly ariaService = new AriaSnapshotService();

  constructor(
    private readonly onStateChange: (state: CapturedScreenState) => void,
    private readonly debounceMs = 500,
  ) {}

  signalChange(page: Page, url: string): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      void this.evaluate(page, url);
    }, this.debounceMs);
  }

  async evaluateNow(page: Page, url: string): Promise<CapturedScreenState | null> {
    return this.evaluate(page, url);
  }

  reset(): void {
    this.currentFingerprint = null;
    this.currentLines = [];
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  private async evaluate(page: Page, url: string): Promise<CapturedScreenState | null> {
    try {
      const { normalized, title, dialogs } = await this.ariaService.capture(page);
      const normalizedRoute = normalizeRoute(url);
      const lines = normalizeAriaLines(normalized);
      const fingerprint = this.computeFingerprint(normalizedRoute, normalized, dialogs);

      if (this.currentFingerprint) {
        const similarity = jaccardSimilarity(this.currentLines, lines);
        if (fingerprint === this.currentFingerprint || similarity >= 0.92) {
          return null;
        }
      }

      const isNew = this.currentFingerprint !== null;
      this.currentFingerprint = fingerprint;
      this.currentLines = lines;

      const state: CapturedScreenState = {
        fingerprint,
        url,
        normalizedRoute,
        title,
        ariaSnapshot: normalized,
        dialogs,
        isNew,
      };
      this.onStateChange(state);
      return state;
    } catch {
      return null;
    }
  }

  computeFingerprint(normalizedRoute: string, aria: string, dialogs: string[]): string {
    const structural = normalizeAriaLines(aria)
      .filter((l) => !/^\s*- text /.test(l))
      .join('\n');
    const payload = normalizedRoute + '\n' + dialogs.join('|') + '\n' + structural;
    return createHash('sha256').update(payload).digest('hex').slice(0, 16);
  }
}
