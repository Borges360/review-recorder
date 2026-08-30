import { useCallback, useEffect, useRef, useState } from 'react';
import { api, eventsWsUrl, audioWsUrl, formatTimer, type SessionRecord, type TimelineEntry } from './api';
import { AudioCapture } from './audio/AudioCapture';

type View = 'home' | 'recording' | 'completed' | 'detail';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatTimelineEntry(entry: TimelineEntry): string {
  switch (entry.type) {
    case 'session':
      return `Início — ${entry.name as string}`;
    case 'pause':
      return 'Pausa';
    case 'resume':
      return 'Retomada';
    case 'screen': {
      const screen = entry.screen as { title?: string };
      return `Tela — ${screen?.title ?? 'desconhecida'}`;
    }
    case 'action':
      return entry.action as string;
    case 'observation': {
      const speech = entry.speech as { text?: string };
      return `🎙 ${speech?.text ?? ''}`;
    }
    case 'evidence':
      return 'Screenshot capturado';
    default:
      return entry.type;
  }
}

function SessionDetailView({
  session,
  outputDir,
  timeline,
  reviewMarkdown,
  onBack,
}: {
  session: SessionRecord;
  outputDir: string | null;
  timeline: TimelineEntry[];
  reviewMarkdown: string | null;
  onBack: () => void;
}) {
  const observations = timeline.filter((e) => e.type === 'observation');

  return (
    <div className="app">
      <button className="btn btn-secondary btn-sm back-btn" onClick={onBack}>
        ← Voltar
      </button>
      <h1>{session.name}</h1>
      <p className="session-meta">
        {session.stoppedAt ? `Finalizada em ${formatDate(session.stoppedAt)}` : formatDate(session.createdAt)}
        {' · '}
        {Math.round((session.activeElapsedMs ?? 0) / 1000)}s ativos
      </p>

      {outputDir && (
        <p className="output-path">
          Artefatos em: <code>{outputDir}</code>
        </p>
      )}

      {observations.length > 0 && (
        <div className="detail-section">
          <h2>Observações por voz ({observations.length})</h2>
          {observations.map((entry) => (
            <div key={entry.id} className="timeline-entry observation">
              <span className="timeline-offset">{entry.offset}</span>
              <p>{formatTimelineEntry(entry)}</p>
            </div>
          ))}
        </div>
      )}

      {timeline.length > 0 && (
        <div className="detail-section">
          <h2>Timeline ({timeline.length} eventos)</h2>
          <div className="timeline-list">
            {timeline.map((entry) => (
              <div key={entry.id} className={`timeline-entry ${entry.type}`}>
                <span className="timeline-offset">{entry.offset}</span>
                <span>{formatTimelineEntry(entry)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {reviewMarkdown && (
        <div className="detail-section">
          <h2>REVIEW.md</h2>
          <pre className="review-preview">{reviewMarkdown}</pre>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>('home');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [initialUrl, setInitialUrl] = useState('http://127.0.0.1:3000/demo/');
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [current, setCurrent] = useState<SessionRecord | null>(null);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [activeMs, setActiveMs] = useState(0);
  const [wallMs, setWallMs] = useState(0);
  const [currentUrl, setCurrentUrl] = useState('');
  const [alert, setAlert] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [openaiConfigured, setOpenaiConfigured] = useState(true);
  const [completedOutput, setCompletedOutput] = useState<string | null>(null);
  const [reviewMarkdown, setReviewMarkdown] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loadingSession, setLoadingSession] = useState(false);
  const [browserClosed, setBrowserClosed] = useState(false);

  const audioRef = useRef<AudioCapture | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef = useRef(false);
  const stoppingRef = useRef(false);
  const activeMsRef = useRef(0);
  const wallMsRef = useRef(0);

  const loadSessions = useCallback(async () => {
    try {
      const list = await api.listSessions();
      setSessions(list);
    } catch {
      /* server offline */
    }
  }, []);

  useEffect(() => {
    void loadSessions();
    void api.getConfig().then((c) => setOpenaiConfigured(c.openaiConfigured)).catch(() => {});
  }, [loadSessions]);

  const finalizeUi = useCallback(async (sessionId: string, sessionRecord?: SessionRecord) => {
    audioRef.current?.stop();
    wsRef.current?.close();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      const stopped =
        sessionRecord ?? (await api.listSessions()).find((s) => s.id === sessionId);
      if (!stopped) return;
      setCurrent(stopped);
      try {
        const exp = await api.exportSession(stopped.id);
        setCompletedOutput(exp.outputDir);
        setReviewMarkdown(exp.reviewMd ?? null);
        setTimeline(exp.reviewJson?.timeline ?? []);
      } catch {
        setCompletedOutput(stopped.outputDir);
        setReviewMarkdown(null);
        setTimeline([]);
      }
      setView('detail');
      void loadSessions();
    } catch (e) {
      stoppingRef.current = false;
      setAlert(String(e));
    }
  }, [loadSessions]);

  const connectEvents = useCallback((sessionId: string) => {
    wsRef.current?.close();
    const ws = new WebSocket(eventsWsUrl(sessionId));
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data as string) as {
          type: string;
          elapsedMs: number;
          activeElapsedMs: number;
          payload: Record<string, unknown>;
        };
        if (event.elapsedMs != null) {
          wallMsRef.current = event.elapsedMs;
          setWallMs(event.elapsedMs);
        }
        if (event.activeElapsedMs != null && !pausedRef.current) {
          activeMsRef.current = event.activeElapsedMs;
          setActiveMs(event.activeElapsedMs);
        }
        switch (event.type) {
          case 'TRANSCRIPT_PARTIAL':
            setPartialTranscript((event.payload.text as string) ?? '');
            break;
          case 'TRANSCRIPT_FINAL':
            setPartialTranscript((event.payload.segment as { text: string })?.text ?? '');
            break;
          case 'NAVIGATION':
            setCurrentUrl((event.payload.url as string) ?? '');
            break;
          case 'TRANSCRIPTION_OFFLINE':
            setAlert('Transcrição temporariamente offline. O áudio está sendo preservado localmente.');
            break;
          case 'TRANSCRIPTION_ONLINE':
            setAlert(null);
            break;
          case 'MICROPHONE_DISCONNECTED':
            setAlert('Microfone desconectado. A navegação continua sendo registrada.');
            break;
          case 'BROWSER_CRASHED':
            setBrowserClosed(true);
            setAlert('Navegador fechado. Clique em "Abrir browser" para continuar a gravação.');
            break;
          case 'SESSION_STOPPED':
            if (!stoppingRef.current) {
              stoppingRef.current = true;
              void finalizeUi(sessionId);
            }
            break;
        }
      } catch {
        /* ignore */
      }
    };
  }, [finalizeUi]);

  const handleStart = async () => {
    if (!name.trim()) return;
    setAlert(null);

    audioRef.current?.stop();
    const capture = new AudioCapture(setMicLevel, (msg) => setAlert(msg));
    audioRef.current = capture;
    capture.beginAcquire();

    try {
      const session = await api.createSession(
        name.trim(),
        initialUrl.trim() || undefined,
        description.trim() || undefined,
      );
      const started = await api.startSession(session.id);
      setCurrent(started);
      setView('recording');
      pausedRef.current = false;
      activeMsRef.current = 0;
      wallMsRef.current = 0;
      setActiveMs(0);
      setWallMs(0);
      setPartialTranscript('');
      setBrowserClosed(false);
      stoppingRef.current = false;
      connectEvents(session.id);
      try {
        await capture.start(audioWsUrl(session.id));
      } catch (e) {
        capture.stop();
        setAlert(e instanceof Error ? e.message : String(e));
      }
      timerRef.current = setInterval(() => {
        if (!pausedRef.current) {
          setActiveMs((m) => m + 1000);
          setWallMs((m) => m + 1000);
        }
      }, 1000);
    } catch (e) {
      setAlert(String(e));
    }
  };

  const handlePause = async () => {
    if (!current) return;
    if (pausedRef.current) {
      audioRef.current?.stop();
      const capture = new AudioCapture(setMicLevel, (msg) => setAlert(msg));
      audioRef.current = capture;
      capture.beginAcquire();
      await api.resumeSession(current.id);
      pausedRef.current = false;
      try {
        await capture.start(audioWsUrl(current.id));
      } catch (e) {
        capture.stop();
        setAlert(e instanceof Error ? e.message : String(e));
      }
    } else {
      await api.pauseSession(current.id);
      pausedRef.current = true;
      audioRef.current?.stop();
    }
    const updated = await api.listSessions();
    const s = updated.find((x) => x.id === current.id);
    if (s) setCurrent(s);
  };

  const handleScreenshot = async () => {
    if (!current) return;
    await api.screenshotSession(current.id);
  };

  const handleStop = async () => {
    if (!current || stoppingRef.current) return;
    stoppingRef.current = true;
    try {
      const stopped = await api.stopSession(current.id);
      await finalizeUi(stopped.id, stopped);
    } catch (e) {
      stoppingRef.current = false;
      setAlert(String(e));
    }
  };

  const handleReopenBrowser = async () => {
    if (!current) return;
    try {
      await api.reopenBrowser(current.id);
      setBrowserClosed(false);
      setAlert(null);
      const updated = await api.listSessions();
      const s = updated.find((x) => x.id === current.id);
      if (s) setCurrent(s);
    } catch (e) {
      setAlert(String(e));
    }
  };

  const handleViewSession = async (session: SessionRecord) => {
    if (session.status !== 'COMPLETED' || !session.outputDir) return;
    setAlert(null);
    setLoadingSession(true);
    setCurrent(session);
    try {
      const exp = await api.exportSession(session.id);
      setCompletedOutput(exp.outputDir);
      setReviewMarkdown(exp.reviewMd ?? null);
      setTimeline(exp.reviewJson?.timeline ?? (await api.getTimeline(session.id)).timeline);
      setView('detail');
    } catch (e) {
      setAlert(String(e));
    } finally {
      setLoadingSession(false);
    }
  };

  const handleFinalizeRecoverable = async (session: SessionRecord) => {
    setAlert(null);
    try {
      const finalized = await api.finalizeSession(session.id);
      setCurrent(finalized);
      const exp = await api.exportSession(finalized.id);
      setCompletedOutput(exp.outputDir);
      setReviewMarkdown(exp.reviewMd ?? null);
      setTimeline(exp.reviewJson?.timeline ?? []);
      setView('detail');
      void loadSessions();
    } catch (e) {
      setAlert(String(e));
    }
  };

  const recoverableSessions = sessions.filter((s) => s.status === 'RECOVERABLE');
  const recentSessions = sessions.filter((s) => s.status !== 'RECOVERABLE');

  if (view === 'recording' && current) {
    const isPaused = current.status === 'PAUSED' || pausedRef.current;
    return (
      <div className="app">
        <div className="recording-header">
          <span className={`recording-dot ${isPaused ? 'paused' : ''}`} />
          <strong>{isPaused ? 'PAUSADO' : 'GRAVANDO'}</strong>
          <span style={{ marginLeft: 'auto', color: '#9aa0a6' }}>{current.name}</span>
        </div>

        <div className="timers">
          <div className="timer-block">
            <span className="timer-label">Ativo</span>
            <span className="timer">{formatTimer(activeMs)}</span>
          </div>
          <div className="timer-block">
            <span className="timer-label">Total</span>
            <span className="timer timer-wall">{formatTimer(wallMs)}</span>
          </div>
        </div>

        <div className="mic-indicator">
          <span>Microfone {isPaused ? 'pausado' : 'ativo'}</span>
          <div className="mic-bar">
            <div className="mic-bar-fill" style={{ width: `${micLevel}%` }} />
          </div>
        </div>

        {alert && <div className="alert">{alert}</div>}
        {!openaiConfigured && !alert && (
          <div className="alert">OPENAI_API_KEY não configurada. Áudio será gravado localmente.</div>
        )}

        <div className="transcript-box">
          {partialTranscript || 'Aguardando fala...'}
        </div>

        <div className="controls">
          <button className="btn btn-secondary" onClick={() => void handlePause()}>
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <button
            className={`btn btn-secondary${browserClosed ? ' btn-highlight' : ''}`}
            onClick={() => void handleReopenBrowser()}
          >
            Abrir browser
          </button>
          <button className="btn btn-secondary" onClick={() => void handleScreenshot()}>
            Screenshot
          </button>
          <button className="btn btn-danger" onClick={() => void handleStop()}>
            Finalizar
          </button>
        </div>

        {browserClosed && (
          <p className="browser-hint">A gravação continua ativa. O perfil do browser preserva login e cookies.</p>
        )}

        <div className="current-page">
          <strong>Página atual</strong>
          <br />
          {currentUrl || current.initialUrl || '—'}
        </div>
      </div>
    );
  }

  if ((view === 'completed' || view === 'detail') && current) {
    return (
      <SessionDetailView
        session={current}
        outputDir={completedOutput ?? current.outputDir}
        timeline={timeline}
        reviewMarkdown={reviewMarkdown}
        onBack={() => {
          setView('home');
          setCurrent(null);
          setTimeline([]);
          setReviewMarkdown(null);
        }}
      />
    );
  }

  return (
    <div className="app">
      <h1>UI Review</h1>

      <label htmlFor="name">Nome da sessão</label>
      <input
        id="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Gerar contrato"
      />

      <label htmlFor="description">Descrição (opcional)</label>
      <input
        id="description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Revisão do fluxo de geração de contrato"
      />

      <label htmlFor="url">URL inicial</label>
      <input
        id="url"
        value={initialUrl}
        onChange={(e) => setInitialUrl(e.target.value)}
        placeholder="https://sistema/..."
      />

      {alert && <div className="alert">{alert}</div>}
      {loadingSession && <div className="alert">Carregando sessão...</div>}

      <button className="btn btn-primary" onClick={() => void handleStart()} disabled={!name.trim() || loadingSession}>
        Iniciar sessão
      </button>

      {recoverableSessions.length > 0 && (
        <div className="sessions-list recoverable">
          <h2>Sessões recuperáveis</h2>
          {recoverableSessions.map((s) => (
            <div key={s.id} className="session-item recoverable-item">
              <div>
                <span>{s.name}</span>
                <span className="recoverable-badge">RECOVERABLE</span>
              </div>
              <div className="recoverable-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => void handleFinalizeRecoverable(s)}>
                  Compilar e finalizar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {recentSessions.length > 0 && (
        <div className="sessions-list">
          <h2>Sessões recentes</h2>
          {recentSessions.map((s) => (
            <div
              key={s.id}
              className={`session-item${s.status === 'COMPLETED' ? ' clickable' : ''}`}
              onClick={() => s.status === 'COMPLETED' && void handleViewSession(s)}
              role={s.status === 'COMPLETED' ? 'button' : undefined}
              tabIndex={s.status === 'COMPLETED' ? 0 : undefined}
              onKeyDown={(e) => {
                if (s.status === 'COMPLETED' && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  void handleViewSession(s);
                }
              }}
            >
              <span>{s.name}</span>
              <span style={{ color: '#9aa0a6' }}>
                {s.status === 'COMPLETED' ? 'Ver resultado →' : formatDate(s.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
