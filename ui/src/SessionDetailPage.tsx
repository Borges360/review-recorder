import { useCallback, useEffect, useState } from 'react';
import { api, type SessionRecord, type TimelineEntry } from './api';
import { navigate } from './routing';

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

function downloadReviewMarkdown(content: string, filename = 'REVIEW.md'): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function SessionDetailView({
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
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const observations = timeline.filter((e) => e.type === 'observation');

  const handleCopyReview = useCallback(async () => {
    if (!reviewMarkdown) return;
    try {
      await navigator.clipboard.writeText(reviewMarkdown);
      setCopyFeedback('Copiado!');
      window.setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
      setCopyFeedback('Falha ao copiar');
      window.setTimeout(() => setCopyFeedback(null), 2500);
    }
  }, [reviewMarkdown]);

  const handleDownloadReview = useCallback(() => {
    if (!reviewMarkdown) return;
    downloadReviewMarkdown(reviewMarkdown);
  }, [reviewMarkdown]);

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
          <div className="review-header">
            <h2>REVIEW.md</h2>
            <div className="review-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => void handleCopyReview()}>
                Copiar
              </button>
              <button className="btn btn-secondary btn-sm" onClick={handleDownloadReview}>
                Baixar
              </button>
              {copyFeedback && <span className="copy-feedback">{copyFeedback}</span>}
            </div>
          </div>
          <pre className="review-preview">{reviewMarkdown}</pre>
        </div>
      )}
    </div>
  );
}

export function SessionDetailPage({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [reviewMarkdown, setReviewMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const record = await api.getSession(sessionId);
        if (cancelled) return;

        if (record.status !== 'COMPLETED' || !record.outputDir) {
          setSession(record);
          setError('Sessão ainda não finalizada ou sem artefatos exportados.');
          return;
        }

        const exp = await api.exportSession(sessionId);
        if (cancelled) return;

        setSession(record);
        setOutputDir(exp.outputDir);
        setReviewMarkdown(exp.reviewMd ?? null);
        setTimeline(exp.reviewJson?.timeline ?? (await api.getTimeline(sessionId)).timeline);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (loading) {
    return (
      <div className="app">
        <div className="alert">Carregando sessão...</div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="app">
        <button className="btn btn-secondary btn-sm back-btn" onClick={() => navigate('/')}>
          ← Voltar
        </button>
        <div className="alert">{error ?? 'Sessão não encontrada'}</div>
      </div>
    );
  }

  return (
    <SessionDetailView
      session={session}
      outputDir={outputDir ?? session.outputDir}
      timeline={timeline}
      reviewMarkdown={reviewMarkdown}
      onBack={() => navigate('/')}
    />
  );
}
