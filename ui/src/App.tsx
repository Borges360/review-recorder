import { useCallback, useEffect, useRef, useState } from 'react';
import { api, eventsWsUrl, audioWsUrl, formatTimer, type SessionRecord } from './api';
import { AudioCapture } from './audio/AudioCapture';
import { SessionDetailPage } from './SessionDetailPage';
import { navigate, sessionPath, useSessionRoute } from './routing';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function App() {
  const routeSessionId = useSessionRoute();
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
  const [browserClosed, setBrowserClosed] = useState(false);
  const [recording, setRecording] = useState(false);

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
      setRecording(false);
      void loadSessions();
      navigate(sessionPath(sessionId));
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
      setRecording(true);
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

  const handleViewSession = (session: SessionRecord) => {
    if (session.status !== 'COMPLETED' || !session.outputDir) return;
    setAlert(null);
    navigate(sessionPath(session.id));
  };

  const handleFinalizeRecoverable = async (session: SessionRecord) => {
    setAlert(null);
    try {
      const finalized = await api.finalizeSession(session.id);
      void loadSessions();
      navigate(sessionPath(finalized.id));
    } catch (e) {
      setAlert(String(e));
    }
  };

  const recoverableSessions = sessions.filter((s) => s.status === 'RECOVERABLE');
  const recentSessions = sessions.filter((s) => s.status !== 'RECOVERABLE');

  if (routeSessionId && !recording) {
    return <SessionDetailPage sessionId={routeSessionId} />;
  }

  if (recording && current) {
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

      <button className="btn btn-primary" onClick={() => void handleStart()} disabled={!name.trim()}>
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
              onClick={() => s.status === 'COMPLETED' && handleViewSession(s)}
              role={s.status === 'COMPLETED' ? 'button' : undefined}
              tabIndex={s.status === 'COMPLETED' ? 0 : undefined}
              onKeyDown={(e) => {
                if (s.status === 'COMPLETED' && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  handleViewSession(s);
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
