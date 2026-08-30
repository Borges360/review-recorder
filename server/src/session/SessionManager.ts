import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type { EventEnvelope, SessionRecord, EvidenceRecord, TimelineEntry, ReviewPackage, TranscriptSegmentRecord } from '../shared/types.js';
import { EVENT_TYPES } from '../shared/events.js';
import { slugify } from '../shared/redaction.js';
import type { AppConfig } from '../shared/types.js';
import { resolveSessionOutputDir } from '../shared/config.js';
import { SessionClock } from './SessionClock.js';
import { SessionStateMachine } from './SessionState.js';
import { EventStore } from '../persistence/EventStore.js';
import { SessionRepository } from '../persistence/SessionRepository.js';
import { ArtifactStore } from '../persistence/ArtifactStore.js';
import { globalEventBus } from '../timeline/EventBus.js';
import { BrowserManager } from '../browser/BrowserManager.js';
import { AudioStream, OpenAITranscriber } from '../voice/OpenAITranscriber.js';
import { FakeTranscriber } from '../voice/FakeTranscriber.js';
import { CorrelationEngine, TranscriptAssembler, newId } from '../timeline/CorrelationEngine.js';
import { SessionCompiler } from '../export/SessionCompiler.js';
import { transcribeOffline } from '../voice/OfflineTranscriber.js';

export class SessionManager {
  private readonly activeSessions = new Map<string, ActiveSession>();

  constructor(
    private readonly config: AppConfig,
    readonly repo: SessionRepository,
  ) {
    this.repo.markRecoverable(['RECORDING', 'PAUSED']);
  }

  createSession(name: string, initialUrl?: string, description?: string): SessionRecord {
    const id = randomUUID();
    const slug = slugify(name);
    const createdAt = new Date().toISOString();
    const session: SessionRecord = {
      id,
      name,
      slug,
      initialUrl: initialUrl ?? null,
      description: description ?? null,
      status: 'CREATED',
      createdAt,
      startedAt: null,
      stoppedAt: null,
      outputDir: null,
      wallElapsedMs: 0,
      activeElapsedMs: 0,
      diagnosticTrace: this.config.diagnosticTrace,
    };
    this.repo.createSession(session);
    return session;
  }

  listSessions(): SessionRecord[] {
    return this.repo.listSessions();
  }

  getSession(id: string): SessionRecord | null {
    return this.repo.getSession(id);
  }

  getActive(id: string): ActiveSession | undefined {
    return this.activeSessions.get(id);
  }

  async startSession(id: string): Promise<SessionRecord> {
    const record = this.repo.getSession(id);
    if (!record) throw new Error('Session not found');
    if (!['CREATED', 'RECOVERABLE'].includes(record.status)) {
      throw new Error(`Cannot start session in status ${record.status}`);
    }

    const fsm = new SessionStateMachine(record.status === 'RECOVERABLE' ? 'RECOVERABLE' : 'CREATED');
    fsm.transition('STARTING');

    const timestamp = new Date();
    const dirName = `${timestamp.toISOString().replace(/[:.]/g, '-').slice(0, 19)}__${record.slug}`;
    const outputDir = join(this.config.sessionsDir, dirName);
    const artifacts = new ArtifactStore(outputDir);
    const eventStore = new EventStore(outputDir);
    eventStore.open();

    const clock = new SessionClock(timestamp);
    const correlation = new CorrelationEngine();
    const transcriptAssembler = new TranscriptAssembler();

    fsm.transition('RECORDING');

    this.repo.updateSession(id, {
      status: 'RECORDING',
      startedAt: clock.startedAtIso,
      outputDir,
    });

    const active: ActiveSession = {
      record: { ...record, status: 'RECORDING', startedAt: clock.startedAtIso, outputDir },
      fsm,
      clock,
      eventStore,
      artifacts,
      correlation,
      transcriptAssembler,
      partialTranscript: '',
      evidenceCounter: 0,
      screenStateIds: new Map(),
      evidenceSpeechLinks: new Map(),
      browser: null,
      audio: null,
      transcriber: null,
      forwardingAudio: true,
    };

    this.setupBrowser(active);
    this.setupVoice(active);

    this.emitEvent(active, EVENT_TYPES.SESSION_STARTED, { name: record.name, initialUrl: record.initialUrl });
    this.activeSessions.set(id, active);

    return this.repo.getSession(id)!;
  }

  async pauseSession(id: string): Promise<SessionRecord> {
    const active = this.requireActive(id);
    if (!active.fsm.canTransition('PAUSED')) throw new Error('Cannot pause');
    active.fsm.transition('PAUSED');
    active.clock.pause();
    active.forwardingAudio = false;
    active.transcriber?.commitBuffer?.();
    await active.browser?.pauseTraceChunk();
    this.emitEvent(active, EVENT_TYPES.SESSION_PAUSED, {});
    this.repo.updateSession(id, { status: 'PAUSED' });
    await this.broadcastHud(active);
    return this.repo.getSession(id)!;
  }

  async resumeSession(id: string): Promise<SessionRecord> {
    const active = this.requireActive(id);
    if (!active.fsm.canTransition('RECORDING')) throw new Error('Cannot resume');
    active.fsm.transition('RECORDING');
    active.clock.resume();
    active.forwardingAudio = true;
    await active.browser?.resumeTraceChunk();
    this.emitEvent(active, EVENT_TYPES.SESSION_RESUMED, {});
    this.repo.updateSession(id, { status: 'RECORDING' });
    await this.broadcastHud(active);
    return this.repo.getSession(id)!;
  }

  async screenshotSession(id: string): Promise<EvidenceRecord> {
    const active = this.requireActive(id);
    this.emitEvent(active, EVENT_TYPES.SCREENSHOT_REQUESTED, {});

    const browser = active.browser;
    const page = browser?.getActivePage();
    if (!browser) throw new Error('Browser not available');

    const filename = browser.getScreenshotService().nextFilename();
    const filePath = active.artifacts.getScreenshotPath(filename);
    if (page) {
      await browser.getScreenshotService().capture(page, filePath);
    } else {
      await browser.captureMockScreenshot(filePath);
    }

    const evidenceId = newId('evidence');
    const speech = active.transcriptAssembler.getActive();
    let speechSegmentId: string | null = speech?.id ?? null;

    if (!speechSegmentId) {
      active.correlation.registerPendingEvidence(evidenceId, active.clock.activeElapsedMs());
      const pending = active.correlation.consumePendingEvidence(2000, active.clock.activeElapsedMs());
      if (pending) speechSegmentId = null;
    } else {
      active.evidenceSpeechLinks.set(evidenceId, speechSegmentId);
    }

    const evidence: EvidenceRecord = {
      id: evidenceId,
      sessionId: id,
      type: 'manual-screenshot',
      file: active.artifacts.getScreenshotRelative(filename),
      screenStateId: active.correlation.currentScreenStateId,
      speechSegmentId,
      timestamp: new Date().toISOString(),
      elapsedMs: active.clock.wallElapsedMs(),
      activeElapsedMs: active.clock.activeElapsedMs(),
    };

    this.emitEvent(active, EVENT_TYPES.SCREENSHOT_CAPTURED, { evidence });
    await this.broadcastHud(active);
    return evidence;
  }

  handleAudio(id: string, pcm: Buffer): void {
    const active = this.activeSessions.get(id);
    if (!active || !active.forwardingAudio) return;
    active.audio?.write(pcm);
    active.transcriber?.appendAudio(pcm);
  }

  async stopSession(id: string): Promise<SessionRecord> {
    const active = this.activeSessions.get(id);
    if (!active) {
      const record = this.repo.getSession(id);
      if (record?.status === 'COMPLETED') return record;
      throw new Error('Session not active');
    }

    if (active.stopping) {
      return this.repo.getSession(id)!;
    }

    if (!active.fsm.canTransition('STOPPING')) {
      const record = this.repo.getSession(id);
      if (record?.status === 'COMPLETED') return record;
      throw new Error('Cannot stop');
    }

    active.stopping = true;
    active.fsm.transition('STOPPING');
    active.forwardingAudio = false;

    active.fsm.transition('PROCESSING');

    active.transcriber?.disconnect();
    await active.audio?.close();
    if (active.browser?.isOpen()) {
      const tracePath = join(active.artifacts.getRawDir(), 'trace.zip');
      await active.browser.stopTrace(tracePath);
      await active.browser.close();
    }

    const wallElapsedMs = active.clock.wallElapsedMs();
    const activeElapsedMs = active.clock.activeElapsedMs();
    const stoppedAt = new Date().toISOString();

    if (this.config.openaiApiKey && existsSync(active.artifacts.getAudioPath())) {
      const { readFileSync } = await import('node:fs');
      const transcriptPath = active.artifacts.getTranscriptPath();
      const hasTranscripts = existsSync(transcriptPath) && readFileSync(transcriptPath, 'utf8').trim().length > 0;
      if (!hasTranscripts) {
        const offlineText = await transcribeOffline(active.artifacts.getAudioPath(), this.config.openaiApiKey);
        if (offlineText?.trim()) {
          const segment = {
            id: newId('speech-offline'),
            sessionId: id,
            itemId: null,
            text: offlineText.trim(),
            startedAtMs: 0,
            endedAtMs: activeElapsedMs,
            screenStateId: active.correlation.currentScreenStateId,
            pageId: active.correlation.currentPageId,
            lastActionId: null,
            scope: 'SCREEN' as const,
            candidateElement: null,
            associationConfidence: 'LOW' as const,
          };
          appendFileSync(transcriptPath, JSON.stringify(segment) + '\n');
          this.emitEvent(active, EVENT_TYPES.TRANSCRIPT_FINAL, { segment, offlineFallback: true });
        }
      }
    }

    await active.eventStore.close();

    this.repo.updateSession(id, {
      status: 'PROCESSING',
      stoppedAt,
      wallElapsedMs,
      activeElapsedMs,
    });

    const compiler = new SessionCompiler(active.artifacts.getSessionDir(), this.repo);
    await compiler.compile(id);

    active.fsm.transition('COMPLETED');
    this.repo.updateSession(id, { status: 'COMPLETED', wallElapsedMs, activeElapsedMs });
    this.emitEvent(active, EVENT_TYPES.SESSION_STOPPED, {});
    this.activeSessions.delete(id);

    return this.repo.getSession(id)!;
  }

  async getTimeline(id: string): Promise<TimelineEntry[]> {
    const session = this.repo.getSession(id);
    if (!session?.outputDir) throw new Error('No timeline available');

    const outputDir = resolveSessionOutputDir(this.config.sessionsDir, session.outputDir);
    const reviewPath = join(outputDir, 'review.json');
    if (existsSync(reviewPath)) {
      const review = JSON.parse(readFileSync(reviewPath, 'utf8')) as ReviewPackage;
      return review.timeline;
    }

    const compiler = new SessionCompiler(outputDir, this.repo);
    const review = await compiler.compile(id);
    return review.timeline;
  }

  async finalizeRecoverableSession(id: string): Promise<SessionRecord> {
    const record = this.repo.getSession(id);
    if (!record) throw new Error('Session not found');
    if (record.status !== 'RECOVERABLE') throw new Error('Session is not recoverable');
    if (!record.outputDir) throw new Error('No session artifacts found');

    const outputDir = resolveSessionOutputDir(this.config.sessionsDir, record.outputDir);
    const compiler = new SessionCompiler(outputDir, this.repo);
    await compiler.compile(id);
    this.repo.updateSession(id, { status: 'COMPLETED' });
    return this.repo.getSession(id)!;
  }

  injectMockBrowserEvent(id: string, type: string, payload: Record<string, unknown>): void {
    const active = this.activeSessions.get(id);
    if (!active?.browser) throw new Error('Session not active');
    active.browser.injectMockEvent(type, payload);
  }

  injectMockScreenState(
    id: string,
    state: {
      fingerprint: string;
      url: string;
      normalizedRoute: string;
      title: string;
      ariaSnapshot: string;
      dialogs: string[];
      isNew: boolean;
    },
  ): void {
    const active = this.activeSessions.get(id);
    if (!active?.browser) throw new Error('Session not active');
    active.browser.injectMockScreenState(state);
  }
  async reopenBrowser(id: string): Promise<void> {
    const active = this.requireActive(id);
    if (active.browser) {
      await active.browser.close();
    }
    this.setupBrowser(active);
    if (active.fsm.getStatus() === 'RECOVERABLE') {
      active.fsm.transition('RECORDING');
      this.repo.updateSession(id, { status: 'RECORDING' });
    }
    await this.broadcastHud(active);
  }

  private setupBrowser(active: ActiveSession): void {
    const sessionId = active.record.id;
    active.browser = new BrowserManager({
      profileDir: this.config.browserProfileDir,
      diagnosticTrace: active.record.diagnosticTrace,
      traceDir: active.artifacts.getRawDir(),
      mockMode: this.config.mockBrowser,
      headless: this.config.browserHeadless,
      onBrowserEvent: (evt) => {
        this.handleBrowserEvent(active, evt);
      },
      onScreenState: (state) => {
        const stateId = newId('state');
        active.correlation.updateScreenState(stateId);
        active.screenStateIds.set(state.fingerprint, stateId);
        const type = state.isNew ? EVENT_TYPES.SCREEN_STATE_CHANGED : EVENT_TYPES.SCREEN_STATE_CREATED;
        this.emitEvent(active, type, { stateId, ...state });
      },
      onBrowserCrash: () => {
        this.emitEvent(active, EVENT_TYPES.BROWSER_CRASHED, {});
        if (active.fsm.canTransition('RECOVERABLE')) {
          active.fsm.transition('RECOVERABLE');
        }
        this.repo.updateSession(sessionId, { status: 'RECOVERABLE' });
      },
      onControl: (action) => {
        void this.handleHudControl(sessionId, action);
      },
    });

    void active.browser.launch(active.record.initialUrl ?? undefined);
  }

  private setupVoice(active: ActiveSession): void {
    const id = active.record.id;
    active.audio = new AudioStream(active.artifacts.getAudioPath());
    active.audio.open();

    const callbacks = {
      onPartial: (delta: string, itemId: string) => {
        if (!active.transcriptAssembler.getActive()) {
          const ctx = active.correlation.getSpeechContext();
          active.transcriptAssembler.startSpeech(itemId, active.clock.activeElapsedMs(), ctx);
        }
        const text = active.transcriptAssembler.appendPartial(delta, itemId);
        active.partialTranscript = text;
        this.emitEvent(active, EVENT_TYPES.TRANSCRIPT_PARTIAL, { text, itemId });
        void this.broadcastHud(active);
      },
      onSpeechStarted: (itemId: string, audioStartMs: number) => {
        const ctx = active.correlation.getSpeechContext();
        const speech = active.transcriptAssembler.startSpeech(
          itemId,
          active.clock.activeElapsedMs(),
          ctx,
        );
        const pendingEv = active.correlation.consumePendingEvidence(2000, active.clock.activeElapsedMs());
        if (pendingEv) active.evidenceSpeechLinks.set(pendingEv, speech.id);
        this.emitEvent(active, EVENT_TYPES.SPEECH_STARTED, { speechId: speech.id, itemId, audioStartMs, context: ctx });
      },
      onSpeechStopped: (_itemId: string) => {
        /* wait for completed */
      },
      onFinal: (text: string, itemId: string) => {
        const { segment } = active.transcriptAssembler.finalizeFromFullText(
          text,
          itemId,
          active.clock.activeElapsedMs(),
          id,
        );
        if (segment) {
          this.emitTranscriptFinal(active, segment);
        }
        active.partialTranscript = '';
        void this.broadcastHud(active);
      },
      onOffline: () => this.emitEvent(active, EVENT_TYPES.TRANSCRIPTION_OFFLINE, {}),
      onOnline: () => this.emitEvent(active, EVENT_TYPES.TRANSCRIPTION_ONLINE, {}),
      onError: (error: string) => this.emitEvent(active, EVENT_TYPES.RECORDER_ERROR, { error }),
    };

    if (this.config.useFakeTranscriber) {
      active.transcriber = new FakeTranscriber(callbacks) as unknown as OpenAITranscriber;
      void (active.transcriber as unknown as FakeTranscriber).connect();
      return;
    }

    if (!this.config.openaiApiKey) {
      this.emitEvent(active, EVENT_TYPES.TRANSCRIPTION_OFFLINE, { reason: 'no_api_key' });
      return;
    }

    active.transcriber = new OpenAITranscriber(this.config.openaiApiKey, callbacks);

    void active.transcriber.connect().catch(() => {
      this.emitEvent(active, EVENT_TYPES.TRANSCRIPTION_OFFLINE, { reason: 'connect_failed' });
    });
  }

  private emitTranscriptFinal(active: ActiveSession, segment: TranscriptSegmentRecord): void {
    appendFileSync(
      active.artifacts.getTranscriptPath(),
      JSON.stringify({ ...segment, timestamp: new Date().toISOString() }) + '\n',
    );
    this.emitEvent(active, EVENT_TYPES.TRANSCRIPT_FINAL, { segment });
  }

  private handleBrowserEvent(active: ActiveSession, evt: Omit<EventEnvelope, 'sequence'>): void {
    const payload = evt.payload as Record<string, unknown>;
    if (payload.pageId) active.correlation.updatePage(payload.pageId as string);

    if (evt.type === EVENT_TYPES.CLICK) {
      const atMs = active.clock.activeElapsedMs();
      const hadActiveSpeech = !!active.transcriptAssembler.getActive();
      const actionId = active.correlation.recordAction((payload.target as never) ?? null, atMs);
      payload.actionId = actionId;

      if (hadActiveSpeech) {
        const segment = active.transcriptAssembler.flushAtClick(
          atMs,
          active.record.id,
          active.correlation.getSpeechContext(),
        );
        if (segment) {
          this.emitTranscriptFinal(active, segment);
          active.partialTranscript = active.transcriptAssembler.getActive()?.partialText ?? '';
        }
      }
    } else if (evt.type === EVENT_TYPES.FORM_SUBMITTED) {
      const actionId = active.correlation.recordAction(
        (payload.target as never) ?? null,
        active.clock.activeElapsedMs(),
      );
      payload.actionId = actionId;
    }

    this.emitEvent(active, evt.type, payload);
    void this.broadcastHud(active);
  }

  private async handleHudControl(id: string, action: string): Promise<void> {
    switch (action) {
      case 'pause':
        await this.pauseSession(id);
        break;
      case 'resume':
        await this.resumeSession(id);
        break;
      case 'screenshot':
        await this.screenshotSession(id);
        break;
      case 'stop':
        await this.stopSession(id);
        break;
    }
  }

  private emitEvent(active: ActiveSession, type: string, payload: Record<string, unknown>): void {
    const event = active.eventStore.append({
      type,
      payload,
      timestamp: new Date().toISOString(),
      elapsedMs: active.clock.wallElapsedMs(),
      activeElapsedMs: active.clock.activeElapsedMs(),
      sessionId: active.record.id,
    });
    globalEventBus.publish(event);
  }

  private async broadcastHud(active: ActiveSession): Promise<void> {
    const page = active.browser?.getActivePage();
    await active.browser?.updateHud({
      status: active.fsm.getStatus(),
      activeElapsedMs: active.clock.activeElapsedMs(),
      wallElapsedMs: active.clock.wallElapsedMs(),
      partialTranscript: active.partialTranscript,
      currentUrl: page?.url() ?? active.record.initialUrl ?? '',
      sessionName: active.record.name,
    });
  }

  private requireActive(id: string): ActiveSession {
    const active = this.activeSessions.get(id);
    if (!active) throw new Error('Session not active');
    return active;
  }
}

interface ActiveSession {
  record: SessionRecord;
  fsm: SessionStateMachine;
  clock: SessionClock;
  eventStore: EventStore;
  artifacts: ArtifactStore;
  correlation: CorrelationEngine;
  transcriptAssembler: TranscriptAssembler;
  partialTranscript: string;
  evidenceCounter: number;
  screenStateIds: Map<string, string>;
  evidenceSpeechLinks: Map<string, string>;
  browser: BrowserManager | null;
  audio: AudioStream | null;
  transcriber: OpenAITranscriber | FakeTranscriber | null;
  forwardingAudio: boolean;
  stopping?: boolean;
}
