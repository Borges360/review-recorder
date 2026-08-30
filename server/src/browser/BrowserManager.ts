import { chromium, type BrowserContext, type Page, type Dialog } from 'playwright';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { INPAGE_AGENT_SOURCE, INPAGE_HUD_SOURCE } from './inpage/scripts.js';
import { ScreenStateEngine, type CapturedScreenState } from './ScreenStateEngine.js';
import { ScreenshotService } from './ScreenshotService.js';
import type { EventEnvelope } from '../shared/types.js';
import { EVENT_TYPES } from '../shared/events.js';

export interface BrowserEvent {
  type: string;
  payload: Record<string, unknown>;
  ts: number;
  url: string;
}

export interface BrowserManagerOptions {
  profileDir: string;
  diagnosticTrace: boolean;
  traceDir?: string;
  mockMode?: boolean;
  headless?: boolean;
  onBrowserEvent: (event: Omit<EventEnvelope, 'sequence'>) => void;
  onScreenState: (state: CapturedScreenState & { pageId: string }) => void;
  onBrowserCrash: () => void;
  onControl: (action: 'pause' | 'resume' | 'screenshot' | 'stop') => void;
}

const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export class BrowserManager {
  private context: BrowserContext | null = null;
  private pages = new Map<string, Page>();
  private pageCounter = 0;
  private activePageId: string | null = null;
  private screenEngine: ScreenStateEngine | null = null;
  private screenshotService = new ScreenshotService();
  private tracing = false;
  private traceChunkCounter = 0;
  private traceDir: string | null = null;
  private mockOpen = false;
  private closing = false;

  constructor(private readonly options: BrowserManagerOptions) {}

  getScreenshotService(): ScreenshotService {
    return this.screenshotService;
  }

  async launch(initialUrl?: string): Promise<void> {
    if (this.options.mockMode) {
      this.mockOpen = true;
      this.activePageId = 'page-1';
      this.pages.set('page-1', null as unknown as Page);
      this.emit(EVENT_TYPES.PAGE_OPENED, { pageId: 'page-1', url: initialUrl ?? 'about:blank' });
      if (initialUrl) {
        this.emit(EVENT_TYPES.NAVIGATION, { pageId: 'page-1', url: initialUrl, kind: 'load' });
      }
      return;
    }

    this.context = await chromium.launchPersistentContext(this.options.profileDir, {
      headless: this.options.headless ?? false,
      viewport: null,
      args: ['--disable-blink-features=AutomationControlled'],
    });

    this.context.on('close', () => {
      if (this.closing) return;
      this.context = null;
      this.pages.clear();
      this.activePageId = null;
      this.tracing = false;
      this.options.onBrowserCrash();
    });

    if (this.options.diagnosticTrace) {
      this.traceDir = this.options.traceDir ?? null;
      await this.context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      this.tracing = true;
    }

    await this.context.exposeBinding('__uiReviewEmit', async (_source, batch: BrowserEvent[]) => {
      for (const evt of batch) {
        this.handleInPageEvent(evt);
      }
    });

    await this.context.exposeBinding('__uiReviewControl', async (_source, action: string) => {
      const a = action as 'pause' | 'resume' | 'screenshot' | 'stop';
      this.options.onControl(a);
    });

    await this.context.addInitScript({ content: INPAGE_AGENT_SOURCE });
    await this.context.addInitScript({ content: INPAGE_HUD_SOURCE });

    this.screenEngine = new ScreenStateEngine((state) => {
      const pageId = this.activePageId ?? 'page-unknown';
      this.options.onScreenState({ ...state, pageId });
    });

    this.context.on('page', (page) => this.registerPage(page, page.opener() != null));

    const existing = this.context.pages();
    if (existing.length > 0) {
      for (const p of existing) this.registerPage(p, false);
    } else {
      await this.context.newPage();
    }

    const page = this.getActivePage();
    if (page && initialUrl) {
      await page.goto(initialUrl, { waitUntil: 'domcontentloaded' });
    } else if (page && existing.length === 0) {
      await page.goto('about:blank');
    }
  }

  /** Test hook — inject browser events in mock mode. */
  injectMockEvent(type: string, payload: Record<string, unknown>): void {
    if (!this.options.mockMode || !this.mockOpen) return;
    this.handleInPageEvent({
      type,
      payload,
      ts: Date.now(),
      url: (payload.url as string) ?? 'http://mock.test/',
    });
  }

  /** Test hook — inject screen state in mock mode. */
  injectMockScreenState(state: CapturedScreenState): void {
    if (!this.options.mockMode || !this.mockOpen) return;
    const pageId = this.activePageId ?? 'page-1';
    this.options.onScreenState({ ...state, pageId });
  }

  private registerPage(page: Page, isPopup: boolean): void {
    const pageId = `page-${++this.pageCounter}`;
    this.pages.set(pageId, page);
    this.activePageId = pageId;

    const eventType = isPopup ? EVENT_TYPES.POPUP_OPENED : EVENT_TYPES.PAGE_OPENED;
    this.emit(eventType, { pageId, url: page.url(), isPopup });

    page.on('close', () => {
      this.emit(EVENT_TYPES.PAGE_CLOSED, { pageId, url: page.url() });
      this.pages.delete(pageId);
      if (this.activePageId === pageId) {
        const remaining = [...this.pages.keys()];
        this.activePageId = remaining[remaining.length - 1] ?? null;
      }
    });

    page.on('dialog', (dialog: Dialog) => {
      this.emit(EVENT_TYPES.DIALOG, {
        pageId,
        url: page.url(),
        dialogType: dialog.type(),
        message: dialog.message(),
      });
      void dialog.dismiss().catch(() => {});
    });

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        this.activePageId = pageId;
        this.emit(EVENT_TYPES.NAVIGATION, { pageId, url: page.url(), kind: 'load' });
        this.screenEngine?.signalChange(page, page.url());
      }
    });

    page.on('crash', () => {
      this.options.onBrowserCrash();
    });

    void this.screenEngine?.signalChange(page, page.url());
  }

  private handleInPageEvent(evt: BrowserEvent): void {
    const pageId = this.activePageId ?? 'page-unknown';
    const page = pageId ? this.pages.get(pageId) : null;

    switch (evt.type) {
      case 'pointerdown':
        this.emit(EVENT_TYPES.POINTER_DOWN, { pageId, url: evt.url, target: evt.payload.target });
        break;
      case 'click':
        this.emit(EVENT_TYPES.CLICK, { pageId, url: evt.url, target: evt.payload.target });
        if (page) this.screenEngine?.signalChange(page, evt.url);
        break;
      case 'input-change':
        this.emit(EVENT_TYPES.INPUT_CHANGED, {
          pageId,
          url: evt.url,
          target: evt.payload.target,
          valueCaptured: false,
        });
        break;
      case 'form-submit':
        this.emit(EVENT_TYPES.FORM_SUBMITTED, { pageId, url: evt.url, target: evt.payload.target });
        if (page) this.screenEngine?.signalChange(page, evt.url);
        break;
      case 'key-action':
        this.emit(EVENT_TYPES.KEY_ACTION, { pageId, url: evt.url, ...evt.payload });
        break;
      case 'navigation':
        this.emit(EVENT_TYPES.NAVIGATION, { pageId, url: evt.url, kind: evt.payload.kind });
        if (page) this.screenEngine?.signalChange(page, evt.url as string);
        break;
      case 'dom-mutation-signal':
        this.emit(EVENT_TYPES.DOM_MUTATION_SIGNAL, { pageId, url: evt.url });
        if (page) this.screenEngine?.signalChange(page, evt.url);
        break;
    }
  }

  getActivePage(): Page | null {
    if (!this.activePageId) return null;
    const page = this.pages.get(this.activePageId);
    if (!page) return null;
    return page;
  }

  getActivePageId(): string | null {
    return this.activePageId;
  }

  async captureMockScreenshot(filePath: string): Promise<void> {
    writeFileSync(filePath, MINIMAL_PNG);
  }

  async updateHud(state: Record<string, unknown>): Promise<void> {
    if (this.options.mockMode) return;
    const page = this.getActivePage();
    if (!page) return;
    try {
      await page.evaluate((s) => {
        const w = globalThis as typeof globalThis & {
          __uiReviewHud?: { update(st: Record<string, unknown>): void };
        };
        w.__uiReviewHud?.update(s);
      }, state);
    } catch {
      // Contexto destruído durante navegação ou HUD ainda não injetado — ignorar
    }
  }

  async stopTrace(outputPath: string): Promise<void> {
    if (this.tracing && this.context) {
      await this.context.tracing.stop({ path: outputPath });
      this.tracing = false;
    }
  }

  async pauseTraceChunk(): Promise<void> {
    if (!this.tracing || !this.context || !this.traceDir) return;
    this.traceChunkCounter += 1;
    const path = join(this.traceDir, `trace-chunk-${String(this.traceChunkCounter).padStart(3, '0')}.zip`);
    await this.context.tracing.stopChunk({ path });
  }

  async resumeTraceChunk(): Promise<void> {
    if (!this.tracing || !this.context) return;
    await this.context.tracing.startChunk();
  }

  async close(): Promise<void> {
    this.screenEngine?.reset();
    this.screenshotService.reset();
    if (this.options.mockMode) {
      this.mockOpen = false;
      this.pages.clear();
      this.activePageId = null;
      return;
    }
    this.closing = true;
    try {
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
    } finally {
      this.closing = false;
    }
    this.pages.clear();
    this.activePageId = null;
  }

  isOpen(): boolean {
    return this.options.mockMode ? this.mockOpen : this.context !== null;
  }

  private emit(type: string, payload: Record<string, unknown>): void {
    this.options.onBrowserEvent({
      type,
      payload,
      timestamp: new Date().toISOString(),
      elapsedMs: 0,
      activeElapsedMs: 0,
      sessionId: '',
    });
  }
}

declare global {
  interface Window {
    __uiReviewEmit?: (batch: BrowserEvent[]) => Promise<void>;
    __uiReviewControl?: (action: string) => void;
  }
}
