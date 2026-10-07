import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { EventEnvelope, SessionRecord, EvidenceRecord, TimelineEntry, ReviewPackage, TranscriptSegmentRecord, ElementIdentity } from '../shared/types.js';
import { EVENT_TYPES } from '../shared/events.js';
import { normalizeRoute, slugify } from '../shared/redaction.js';
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
import type { ClickSplitPoint, ScreenSnapshot } from '../timeline/SpeechClickSplitter.js';
import { SessionCompiler } from '../export/SessionCompiler.js';
import { transcribeOfflineDetailed, transcribeWebmChunk } from '../voice/OfflineTranscriber.js';
import { asRawElement, clickablesToSnapshot, fingerprintClickables, limitClickables, toElementIdentity } from '../capture/elementIdentity.js';
import { fakeChunkSegments, shiftChunkSegments } from '../capture/chunkTiming.js';
import { loadClientIds, rememberClientId } from '../capture/clientIds.js';
import { objectKey, publicObjectKey, type RemoteStores } from '../persistence/RemoteStores.js';

export class SessionManager {
  private readonly activeSessions = new Map<string, ActiveSession>();

  constructor(
    private readonly config: AppConfig,
    readonly repo: SessionRepository,
    private readonly remote: RemoteStores | null = null,
  ) {
    this.repo.markRecoverable(['RECORDING', 'PAUSED']);
  }

  async initRemote(): Promise<void> {
    await this.remote?.init();
  }

  createSession(
    name: string,
    initialUrl?: string,
    description?: string,
    capture?: 'playwright' | 'extension',
  ): SessionRecord {
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
      ...(capture === 'extension' ? { capture: 'extension' as const } : {}),
    };
    this.repo.createSession(session);
    return session;
  }

  listSessions(limit = 20): SessionRecord[] {
    return this.repo.listSessions(limit);
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
      speechStartMs: null,
      lastScreenSnapshot: { id: '', url: '', title: '' },
      speechClickMarkers: [],
      browser: null,
      audio: null,
      transcriber: null,
      forwardingAudio: record.capture !== 'extension',
      extensionCapture: record.capture === 'extension',
      acceptedClientIds: record.capture === 'extension' ? loadClientIds(outputDir) : new Set(),
      maxClientWallMs: 0,
      maxClientActiveMs: 0,
      evidenceRecords: [],
      lastSegment: null,
      lastFingerprint: null,
    };

    if (!active.extensionCapture) {
      this.setupBrowser(active);
      this.setupVoice(active);
    }

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
    if (active.transcriber && 'commitBuffer' in active.transcriber) {
      active.transcriber.commitBuffer();
    }
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
    if (active.speechStartMs === null) {
      active.speechStartMs = active.clock.activeElapsedMs();
    }
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

    let wallElapsedMs = active.clock.wallElapsedMs();
    let activeElapsedMs = active.clock.activeElapsedMs();
    if (active.extensionCapture && active.maxClientActiveMs > 0) {
      activeElapsedMs = active.maxClientActiveMs;
      wallElapsedMs = active.maxClientWallMs > 0 ? active.maxClientWallMs : wallElapsedMs;
    }
    const stoppedAt = new Date().toISOString();

    if (this.config.openaiApiKey && existsSync(active.artifacts.getAudioPath())) {
      const { readFileSync } = await import('node:fs');
      const transcriptPath = active.artifacts.getTranscriptPath();
      const hasTranscripts = existsSync(transcriptPath) && readFileSync(transcriptPath, 'utf8').trim().length > 0;
      if (!hasTranscripts) {
        const offline = await transcribeOfflineDetailed(active.artifacts.getAudioPath(), this.config.openaiApiKey);
        if (offline.text?.trim()) {
          const segment = {
            id: newId('speech-offline'),
            sessionId: id,
            itemId: null,
            text: offline.text.trim(),
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
        } else if (offline.error) {
          this.emitEvent(active, EVENT_TYPES.RECORDER_ERROR, {
            error: `Offline transcription failed: ${offline.error}`,
            offlineFallback: true,
          });
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
    if (active.extensionCapture && this.remote) {
      const mdPath = active.artifacts.getReviewMdPath();
      const jsonPath = active.artifacts.getReviewJsonPath();
      if (existsSync(mdPath) && existsSync(jsonPath)) {
        await this.remote
          .publishExport(id, readFileSync(mdPath, 'utf8'), readFileSync(jsonPath, 'utf8'))
          .catch((error) => console.warn(`Export upload failed: ${String(error)}`));
      }
    }

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

  async ingestExtensionEvents(
    id: string,
    events: ExtensionClientEvent[],
  ): Promise<{ accepted: string[]; duplicates: string[] }> {
    const active = this.requireExtensionRecording(id);
    const accepted: string[] = [];
    const duplicates: string[] = [];
    for (const event of events) {
      if (!event.clientId?.trim()) throw new Error('clientId is required');
      if (active.acceptedClientIds.has(event.clientId)) {
        duplicates.push(event.clientId);
        continue;
      }
      this.applyExtensionEvent(active, event);
      rememberClientId(active.artifacts.getSessionDir(), active.acceptedClientIds, event.clientId);
      accepted.push(event.clientId);
    }
    return { accepted, duplicates };
  }

  async ingestExtensionAudio(
    id: string,
    clientId: string,
    chunkStartMs: number,
    durationMs: number,
    bytes: Buffer,
  ): Promise<{ duplicate: boolean; transcribed: boolean; error?: string; attachedEvidenceIds: string[] }> {
    const active = this.requireExtensionRecording(id);
    if (!clientId.trim()) throw new Error('clientId is required');
    if (bytes.length === 0) throw new Error('audio chunk is empty');
    if (active.acceptedClientIds.has(clientId)) {
      return { duplicate: true, transcribed: true, attachedEvidenceIds: [] };
    }

    const filename = `${clientId}.webm`;
    const dir = join(active.artifacts.getRawDir(), 'audio-chunks');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), bytes);
    await this.remote?.putObject(objectKey(id, 'audio', filename), bytes, 'audio/webm').catch((error) => {
      console.warn(`Audio upload failed: ${String(error)}`);
    });
    rememberClientId(active.artifacts.getSessionDir(), active.acceptedClientIds, clientId);

    const safeDuration = durationMs > 0 ? durationMs : 5000;
    let relative = fakeChunkSegments(safeDuration);
    let error: string | undefined;
    if (!this.config.useFakeTranscriber) {
      if (!this.config.openaiApiKey) {
        error = 'no_api_key';
        relative = [];
      } else {
        const result = await transcribeWebmChunk(bytes, this.config.openaiApiKey, safeDuration);
        relative = result.segments;
        error = result.error;
      }
    }

    const attachedEvidenceIds: string[] = [];
    for (const segment of shiftChunkSegments(relative, chunkStartMs)) {
      const ctx = active.correlation.getSpeechContext();
      const linked =
        Boolean(ctx.lastActionTarget) &&
        ctx.lastActionAtMs <= segment.endMs &&
        segment.startMs - ctx.lastActionAtMs <= 8000;
      const record: TranscriptSegmentRecord = {
        id: newId('speech'),
        sessionId: id,
        itemId: clientId,
        text: segment.text,
        startedAtMs: segment.startMs,
        endedAtMs: segment.endMs,
        screenStateId: ctx.screenStateId,
        pageId: ctx.pageId,
        lastActionId: linked ? ctx.lastActionId : null,
        scope: linked ? 'ELEMENT' : 'SCREEN',
        candidateElement: linked ? ctx.lastActionTarget : null,
        associationConfidence: linked ? 'HIGH' : 'LOW',
      };
      active.lastSegment = record;
      this.emitTranscriptFinal(active, record);
      for (const evidence of active.evidenceRecords) {
        if (evidence.speechSegmentId) continue;
        if (evidence.activeElapsedMs < record.startedAtMs - 2000) continue;
        if (evidence.activeElapsedMs > record.endedAtMs + 2000) continue;
        evidence.speechSegmentId = record.id;
        attachedEvidenceIds.push(evidence.id);
        void this.remote?.mirrorEvidence(evidence).catch(() => {});
      }
      this.writeEvidenceIndex(active);
    }

    if (error) {
      this.emitEventAt(active, EVENT_TYPES.TRANSCRIPTION_OFFLINE, { clientId, error }, chunkStartMs, chunkStartMs);
      writeFileSync(
        join(dir, `${clientId}.pending.json`),
        JSON.stringify({ clientId, chunkStartMs, error }),
        'utf8',
      );
    }

    return { duplicate: false, transcribed: !error && relative.length > 0, error, attachedEvidenceIds };
  }

  async ingestExtensionScreenshot(
    id: string,
    clientId: string,
    elapsedMs: number,
    activeElapsedMs: number,
    png: Buffer,
  ): Promise<EvidenceRecord & { duplicate?: boolean }> {
    const active = this.requireExtensionRecording(id);
    if (!clientId.trim()) throw new Error('clientId is required');
    if (png.length === 0) throw new Error('screenshot is empty');
    const existing = active.evidenceRecords.find((item) => item.id === clientId);
    if (active.acceptedClientIds.has(clientId) && existing) {
      return { ...existing, duplicate: true };
    }

    active.evidenceCounter += 1;
    const filename = `screenshot-${String(active.evidenceCounter).padStart(3, '0')}.png`;
    writeFileSync(active.artifacts.getScreenshotPath(filename), png);
    const key = objectKey(id, 'evidence', filename);
    await this.remote?.putObject(key, png, 'image/png').catch((error) => {
      console.warn(`Screenshot upload failed: ${String(error)}`);
    });

    let speechSegmentId: string | null = null;
    const last = active.lastSegment;
    if (last && activeElapsedMs >= last.startedAtMs - 2000 && activeElapsedMs <= last.endedAtMs + 2000) {
      speechSegmentId = last.id;
    }

    const evidence: EvidenceRecord = {
      id: clientId,
      sessionId: id,
      type: 'manual-screenshot',
      file: publicObjectKey(id, 'evidence', filename),
      screenStateId: active.correlation.currentScreenStateId,
      speechSegmentId,
      timestamp: new Date().toISOString(),
      elapsedMs,
      activeElapsedMs,
    };
    active.evidenceRecords.push(evidence);
    this.writeEvidenceIndex(active);
    rememberClientId(active.artifacts.getSessionDir(), active.acceptedClientIds, clientId);
    this.emitEventAt(active, EVENT_TYPES.SCREENSHOT_REQUESTED, { clientId }, elapsedMs, activeElapsedMs);
    this.emitEventAt(active, EVENT_TYPES.SCREENSHOT_CAPTURED, { evidence }, elapsedMs, activeElapsedMs);
    void this.remote?.mirrorEvidence(evidence).catch(() => {});
    return evidence;
  }

  listExtensionEvidence(id: string): EvidenceRecord[] {
    const session = this.repo.getSession(id);
    if (!session?.outputDir) return [];
    const outputDir = resolveSessionOutputDir(this.config.sessionsDir, session.outputDir);
    const indexPath = join(outputDir, 'raw', 'evidence.jsonl');
    if (!existsSync(indexPath)) return [];
    return readFileSync(indexPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EvidenceRecord);
  }

  getExtensionEvidence(id: string, evidenceId: string): { record: EvidenceRecord; bytes: Buffer } | null {
    const session = this.repo.getSession(id);
    if (!session?.outputDir) return null;
    const outputDir = resolveSessionOutputDir(this.config.sessionsDir, session.outputDir);
    const indexPath = join(outputDir, 'raw', 'evidence.jsonl');
    if (!existsSync(indexPath)) return null;
    const record = readFileSync(indexPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EvidenceRecord & { localFile?: string })
      .find((item) => item.id === evidenceId);
    if (!record?.localFile) return null;
    const filePath = join(outputDir, record.localFile);
    if (!existsSync(filePath)) return null;
    return { record, bytes: readFileSync(filePath) };
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
        active.lastScreenSnapshot = {
          id: stateId,
          url: state.url,
          title: state.title,
        };
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
        if (active.speechStartMs === null) {
          active.speechStartMs = active.clock.activeElapsedMs();
        }
        if (!active.transcriptAssembler.getActive()) {
          const ctx = active.correlation.getSpeechContext();
          const speech = active.transcriptAssembler.startSpeech(
            itemId,
            active.clock.activeElapsedMs(),
            ctx,
          );
          const pendingEv = active.correlation.consumePendingEvidence(2000, active.clock.activeElapsedMs());
          if (pendingEv) active.evidenceSpeechLinks.set(pendingEv, speech.id);
          this.emitEvent(active, EVENT_TYPES.SPEECH_STARTED, {
            speechId: speech.id,
            itemId,
            audioStartMs,
            context: ctx,
          });
        }
      },
      onSpeechStopped: (_itemId: string) => {
        /* wait for completed */
      },
      onFinal: (text: string, itemId: string) => {
        const endedAtMs = active.clock.activeElapsedMs();
        const { segments } = active.transcriptAssembler.finalizeFromFullText(
          text,
          itemId,
          endedAtMs,
          id,
          {
            clickPoints: active.speechClickMarkers,
            speechStartMs: active.speechStartMs ?? 0,
            startScreen: active.lastScreenSnapshot,
          },
        );
        for (const segment of segments) {
          this.emitTranscriptFinal(active, segment);
        }
        active.partialTranscript = '';
        active.speechClickMarkers = [];
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
    void this.remote?.mirrorTranscript(segment).catch((error) => {
      console.warn(`Transcript mirror failed: ${String(error)}`);
    });
  }

  private handleBrowserEvent(active: ActiveSession, evt: Omit<EventEnvelope, 'sequence'>): void {
    const payload = evt.payload as Record<string, unknown>;
    if (payload.pageId) active.correlation.updatePage(payload.pageId as string);

    if (evt.type === EVENT_TYPES.CLICK) {
      const atMs = active.clock.activeElapsedMs();
      const actionId = active.correlation.recordAction((payload.target as never) ?? null, atMs);
      payload.actionId = actionId;

      active.speechClickMarkers.push({
        atMs,
        target: (payload.target as ElementIdentity | null) ?? null,
        screen: { ...active.lastScreenSnapshot },
      });

      const hadActiveSpeech = !!active.transcriptAssembler.getActive();
      if (hadActiveSpeech) {
        const postClickContext = active.correlation.getSpeechContext();
        const segment = active.transcriptAssembler.flushAtClick(
          atMs,
          active.record.id,
          postClickContext,
        );
        if (segment) {
          this.emitTranscriptFinal(active, segment);
          active.partialTranscript = active.transcriptAssembler.getActive()?.partialText ?? '';
        } else {
          active.transcriptAssembler.recordClickBoundary(atMs, postClickContext);
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
    void this.remote?.mirrorEvent(event).catch((error) => {
      console.warn(`Event mirror failed: ${String(error)}`);
    });
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

  private requireExtensionRecording(id: string): ActiveSession {
    const active = this.requireActive(id);
    if (!active.extensionCapture) throw new Error('Session is not an extension capture');
    if (active.fsm.getStatus() !== 'RECORDING') throw new Error('Session is not recording');
    return active;
  }

  private applyExtensionEvent(active: ActiveSession, event: ExtensionClientEvent): void {
    const url = event.url ?? '';
    if (url) active.correlation.updatePage(url);
    const payload = event.payload ?? {};
    const elapsed = Number(event.elapsedMs) || 0;
    const activeMs = Number(event.activeElapsedMs) || 0;

    if (event.type === 'screen-state') {
      const rawItems = Array.isArray(payload.clickables) ? payload.clickables : [];
      const clickables = limitClickables(
        rawItems
          .map((item) => asRawElement(item))
          .filter((item): item is NonNullable<typeof item> => item !== null)
          .map((item) => toElementIdentity(item)),
      );
      const route = normalizeRoute(url || 'http://localhost/');
      const title = typeof payload.title === 'string' ? payload.title : '';
      const fingerprint =
        typeof payload.fingerprint === 'string' && payload.fingerprint
          ? payload.fingerprint
          : fingerprintClickables(route, clickables);
      if (active.lastFingerprint === fingerprint) return;
      const isChange = active.lastFingerprint !== null;
      active.lastFingerprint = fingerprint;
      const stateId = newId('state');
      active.correlation.updateScreenState(stateId);
      active.lastScreenSnapshot = { id: stateId, url, title };
      this.emitEventAt(
        active,
        isChange ? EVENT_TYPES.SCREEN_STATE_CHANGED : EVENT_TYPES.SCREEN_STATE_CREATED,
        {
          stateId,
          fingerprint,
          url,
          normalizedRoute: route,
          title,
          ariaSnapshot: clickablesToSnapshot(clickables),
          dialogs: [],
          clickables,
          isNew: isChange,
        },
        elapsed,
        activeMs,
      );
      return;
    }

    const target = asRawElement(payload.target);
    const identity = target ? toElementIdentity(target) : null;

    if (event.type === 'click') {
      const actionId = active.correlation.recordAction(identity, activeMs);
      active.speechClickMarkers.push({
        atMs: activeMs,
        target: identity,
        screen: { ...active.lastScreenSnapshot },
      });
      this.emitEventAt(active, EVENT_TYPES.CLICK, { url, target: identity, actionId }, elapsed, activeMs);
      return;
    }

    if (event.type === 'form-submit') {
      const actionId = active.correlation.recordAction(identity, activeMs);
      this.emitEventAt(active, EVENT_TYPES.FORM_SUBMITTED, { url, target: identity, actionId }, elapsed, activeMs);
      return;
    }

    const typeByName = {
      pointerdown: EVENT_TYPES.POINTER_DOWN,
      'input-change': EVENT_TYPES.INPUT_CHANGED,
      'key-action': EVENT_TYPES.KEY_ACTION,
      navigation: EVENT_TYPES.NAVIGATION,
    } as const;
    const mapped = typeByName[event.type as keyof typeof typeByName];
    if (!mapped) throw new Error(`Unsupported extension event ${event.type}`);
    this.emitEventAt(active, mapped, { ...payload, url, target: identity }, elapsed, activeMs);
  }

  private emitEventAt(
    active: ActiveSession,
    type: string,
    payload: Record<string, unknown>,
    elapsedMs: number,
    activeElapsedMs: number,
  ): void {
    active.maxClientWallMs = Math.max(active.maxClientWallMs, elapsedMs);
    active.maxClientActiveMs = Math.max(active.maxClientActiveMs, activeElapsedMs);
    const event = active.eventStore.append({
      type,
      payload,
      timestamp: new Date().toISOString(),
      elapsedMs,
      activeElapsedMs,
      sessionId: active.record.id,
    });
    globalEventBus.publish(event);
    void this.remote?.mirrorEvent(event).catch((error) => {
      console.warn(`Event mirror failed: ${String(error)}`);
    });
  }

  private writeEvidenceIndex(active: ActiveSession): void {
    const lines = active.evidenceRecords.map((record) => {
      const filename = record.file.split('/').pop() ?? 'screenshot.png';
      return JSON.stringify({ ...record, localFile: `evidence/${filename}` });
    });
    writeFileSync(join(active.artifacts.getRawDir(), 'evidence.jsonl'), `${lines.join('\n')}\n`);
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
  speechStartMs: number | null;
  lastScreenSnapshot: ScreenSnapshot;
  speechClickMarkers: ClickSplitPoint[];
  stopping?: boolean;
  extensionCapture: boolean;
  acceptedClientIds: Set<string>;
  maxClientWallMs: number;
  maxClientActiveMs: number;
  evidenceRecords: EvidenceRecord[];
  lastSegment: TranscriptSegmentRecord | null;
  lastFingerprint: string | null;
}

export interface ExtensionClientEvent {
  clientId: string;
  type: 'click' | 'pointerdown' | 'input-change' | 'form-submit' | 'key-action' | 'navigation' | 'screen-state';
  activeElapsedMs: number;
  elapsedMs: number;
  url?: string;
  payload?: Record<string, unknown>;
}
