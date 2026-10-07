import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '../shared/types.js';
import { resolveSessionOutputDir } from '../shared/config.js';
import { SessionRepository } from '../persistence/SessionRepository.js';
import { SessionCompiler } from '../export/SessionCompiler.js';
import { EVENT_TYPES } from '../shared/events.js';
import { newId } from '../timeline/CorrelationEngine.js';
import { transcribeOfflineDetailed } from './OfflineTranscriber.js';

export interface RecoverTranscriptResult {
  sessionId: string;
  outputDir: string;
  textLength: number;
  chunksProcessed: number;
  timelineEntries: number;
  skipped: boolean;
}

export async function recoverSessionTranscript(
  sessionId: string,
  config: AppConfig,
  repo: SessionRepository,
  options: { force?: boolean } = {},
): Promise<RecoverTranscriptResult> {
  const session = repo.getSession(sessionId);
  if (!session?.outputDir) {
    throw new Error('Session not found or has no output directory');
  }
  if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is required for offline transcription recovery');
  }

  const outputDir = resolveSessionOutputDir(config.sessionsDir, session.outputDir);
  const audioPath = join(outputDir, 'raw', 'audio.wav');
  const transcriptPath = join(outputDir, 'raw', 'transcript.jsonl');
  const eventsPath = join(outputDir, 'raw', 'events.jsonl');

  if (!existsSync(audioPath)) {
    throw new Error(`Audio not found: ${audioPath}`);
  }

  const eventsRaw = readFileSync(eventsPath, 'utf8');
  const hasTranscriptFinal = eventsRaw.includes(`"type":"${EVENT_TYPES.TRANSCRIPT_FINAL}"`);
  const hasTranscriptFile = existsSync(transcriptPath) && readFileSync(transcriptPath, 'utf8').trim().length > 0;

  if ((hasTranscriptFinal || hasTranscriptFile) && !options.force) {
    const compiler = new SessionCompiler(outputDir, repo);
    const review = await compiler.compile(sessionId);
    return {
      sessionId,
      outputDir,
      textLength: 0,
      chunksProcessed: 0,
      timelineEntries: review.timeline.length,
      skipped: true,
    };
  }

  const transcription = await transcribeOfflineDetailed(audioPath, config.openaiApiKey);
  if (!transcription.text?.trim()) {
    throw new Error(transcription.error ?? 'Offline transcription returned empty text');
  }

  const text = transcription.text.trim();
  const activeElapsedMs = session.activeElapsedMs ?? 0;
  const segment = {
    id: newId('speech-offline'),
    sessionId,
    itemId: null,
    text,
    startedAtMs: 0,
    endedAtMs: activeElapsedMs,
    screenStateId: null,
    pageId: null,
    lastActionId: null,
    scope: 'SCREEN' as const,
    candidateElement: null,
    associationConfidence: 'LOW' as const,
    offlineFallback: true,
    recovered: true,
  };

  writeFileSync(transcriptPath, JSON.stringify({ ...segment, timestamp: new Date().toISOString() }) + '\n');

  if (!hasTranscriptFinal) {
    const lines = eventsRaw.split('\n').filter((line) => line.trim());
    let lastSequence = 0;
    let lastElapsed = activeElapsedMs;
    for (const line of lines) {
      try {
        const evt = JSON.parse(line) as { sequence?: number; activeElapsedMs?: number; type?: string };
        if (typeof evt.sequence === 'number') lastSequence = evt.sequence;
        if (evt.type === EVENT_TYPES.SESSION_STOPPED && typeof evt.activeElapsedMs === 'number') {
          lastElapsed = evt.activeElapsedMs;
        }
      } catch {
        /* ignore malformed lines */
      }
    }

    const transcriptEvent = {
      type: EVENT_TYPES.TRANSCRIPT_FINAL,
      payload: { segment: { ...segment, endedAtMs: lastElapsed }, offlineFallback: true, recovered: true },
      timestamp: new Date().toISOString(),
      elapsedMs: session.wallElapsedMs ?? lastElapsed,
      activeElapsedMs: lastElapsed,
      sessionId,
      sequence: lastSequence + 1,
    };

    const stoppedIdx = lines.findIndex((line) => line.includes(`"type":"${EVENT_TYPES.SESSION_STOPPED}"`));
    if (stoppedIdx >= 0) {
      lines.splice(stoppedIdx, 0, JSON.stringify(transcriptEvent));
    } else {
      lines.push(JSON.stringify(transcriptEvent));
    }
    writeFileSync(eventsPath, lines.join('\n') + '\n');
  }

  const compiler = new SessionCompiler(outputDir, repo);
  const review = await compiler.compile(sessionId);

  return {
    sessionId,
    outputDir,
    textLength: text.length,
    chunksProcessed: transcription.chunksProcessed,
    timelineEntries: review.timeline.length,
    skipped: false,
  };
}
