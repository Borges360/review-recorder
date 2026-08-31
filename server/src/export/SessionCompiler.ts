import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { EventEnvelope, ReviewPackage, TimelineEntry } from '../shared/types.js';
import { formatOffset } from '../shared/redaction.js';
import { EVENT_TYPES } from '../shared/events.js';
import type { SessionRepository } from '../persistence/SessionRepository.js';
import { JsonExporter } from './JsonExporter.js';
import { MarkdownExporter } from './MarkdownExporter.js';
import { TimelineReducer } from '../timeline/TimelineReducer.js';
import {
  splitTranscriptByClickTimes,
  type ClickSplitPoint,
  type ScreenSnapshot,
} from '../timeline/SpeechClickSplitter.js';
import type { ElementIdentity } from '../shared/types.js';

interface StagedEntry {
  atMs: number;
  entry: Omit<TimelineEntry, 'id'>;
}

function screenAtTime(timeline: { atMs: number; screen: ScreenSnapshot }[], atMs: number): ScreenSnapshot {
  let current = timeline[0]?.screen ?? { id: '', url: '', title: '' };
  for (const entry of timeline) {
    if (entry.atMs <= atMs) current = entry.screen;
    else break;
  }
  return current;
}

export class SessionCompiler {
  constructor(
    private readonly sessionDir: string,
    private readonly repo: SessionRepository,
  ) {}

  async compile(sessionId: string): Promise<ReviewPackage> {
    const session = this.repo.getSession(sessionId);
    if (!session) throw new Error('Session not found');

    const eventsPath = `${this.sessionDir}/raw/events.jsonl`;
    const staged: StagedEntry[] = [];
    let lastScreenTitle = '';
    let lastScreenUrl = '';
    let lastScreenId = '';
    const screenStates = new Map<string, ScreenSnapshot>();
    const screenTimeline: { atMs: number; screen: ScreenSnapshot }[] = [];
    const clickPoints: ClickSplitPoint[] = [];
    let inputBuffer: { label: string; startMs: number; endMs: number } | null = null;

    const stream = createReadStream(eventsPath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      let event: EventEnvelope;
      try {
        event = JSON.parse(line) as EventEnvelope;
      } catch {
        continue;
      }

      const offset = formatOffset(event.activeElapsedMs);
      const payload = event.payload as Record<string, unknown>;

      switch (event.type) {
        case EVENT_TYPES.SESSION_STARTED:
          staged.push({
            atMs: event.activeElapsedMs,
            entry: {
              offset,
              type: 'session',
              label: 'SESSION START',
              name: payload.name,
            },
          });
          break;

        case EVENT_TYPES.SESSION_PAUSED:
          staged.push({ atMs: event.activeElapsedMs, entry: { offset, type: 'pause', label: 'PAUSE' } });
          break;

        case EVENT_TYPES.SESSION_RESUMED:
          staged.push({ atMs: event.activeElapsedMs, entry: { offset, type: 'resume', label: 'RESUME' } });
          break;

        case EVENT_TYPES.SCREEN_STATE_CREATED:
        case EVENT_TYPES.SCREEN_STATE_CHANGED: {
          lastScreenTitle = (payload.title as string) ?? lastScreenTitle;
          lastScreenUrl = (payload.url as string) ?? lastScreenUrl;
          lastScreenId = (payload.stateId as string) ?? lastScreenId;
          const screen = { id: lastScreenId, url: lastScreenUrl, title: lastScreenTitle };
          if (lastScreenId) screenStates.set(lastScreenId, screen);
          screenTimeline.push({ atMs: event.activeElapsedMs, screen });
          staged.push({
            atMs: event.activeElapsedMs,
            entry: { offset, type: 'screen', screen },
          });
          inputBuffer = null;
          break;
        }

        case EVENT_TYPES.CLICK: {
          inputBuffer = null;
          const target = payload.target as Record<string, unknown> | null;
          const name = target?.accessibleName ?? target?.text ?? 'elemento';
          const screen = { id: lastScreenId, url: lastScreenUrl, title: lastScreenTitle };
          clickPoints.push({
            atMs: event.activeElapsedMs,
            target: (target as ElementIdentity | null) ?? null,
            screen,
          });
          staged.push({
            atMs: event.activeElapsedMs,
            entry: {
              offset,
              type: 'action',
              action: `Click "${name}"`,
              target,
            },
          });
          break;
        }

        case EVENT_TYPES.INPUT_CHANGED: {
          const target = payload.target as Record<string, unknown> | null;
          const label = (target?.label as string) ?? (target?.accessibleName as string) ?? 'campo';
          if (inputBuffer && inputBuffer.label === label) {
            inputBuffer.endMs = event.activeElapsedMs;
          } else {
            if (inputBuffer) {
              staged.push(this.inputStagedEntry(inputBuffer));
            }
            inputBuffer = { label, startMs: event.activeElapsedMs, endMs: event.activeElapsedMs };
          }
          break;
        }

        case EVENT_TYPES.FORM_SUBMITTED:
          if (inputBuffer) {
            staged.push(this.inputStagedEntry(inputBuffer));
            inputBuffer = null;
          }
          staged.push({
            atMs: event.activeElapsedMs,
            entry: { offset, type: 'action', action: 'Submit formulário' },
          });
          break;

        case EVENT_TYPES.TRANSCRIPT_FINAL: {
          if (inputBuffer) {
            staged.push(this.inputStagedEntry(inputBuffer));
            inputBuffer = null;
          }
          const segment = payload.segment as Record<string, unknown>;
          const speechText = (segment.text as string) ?? '';
          const speechStartMs =
            typeof segment.startedAtMs === 'number' ? segment.startedAtMs : event.activeElapsedMs;
          const speechEndMs =
            typeof segment.endedAtMs === 'number' ? segment.endedAtMs : event.activeElapsedMs;
          const startScreen = screenAtTime(screenTimeline, speechStartMs);
          const chunks = splitTranscriptByClickTimes(
            speechText,
            speechStartMs,
            speechEndMs,
            clickPoints,
            startScreen,
          );

          for (const chunk of chunks) {
            staged.push({
              atMs: chunk.startedAtMs,
              entry: {
                offset: formatOffset(chunk.startedAtMs),
                type: 'observation',
                scope: chunk.scope,
                speech: { text: chunk.text },
                screen: chunk.screen,
                candidateElement: chunk.candidateElement,
                associationConfidence: chunk.associationConfidence,
              },
            });
          }
          break;
        }

        case EVENT_TYPES.SCREENSHOT_CAPTURED: {
          const evidence = payload.evidence as Record<string, unknown>;
          staged.push({
            atMs: event.activeElapsedMs,
            entry: {
              offset,
              type: 'evidence',
              evidence: [{ type: 'screenshot', path: evidence.file }],
              screen: { id: lastScreenId, url: lastScreenUrl, title: lastScreenTitle },
            },
          });
          break;
        }
      }
    }

    if (inputBuffer) {
      staged.push(this.inputStagedEntry(inputBuffer));
    }

    staged.sort((a, b) => a.atMs - b.atMs || 0);
    const entries: TimelineEntry[] = staged.map((item, idx) => ({
      ...item.entry,
      id: `tl-${idx}`,
    }));

    const reducer = new TimelineReducer();
    const review: ReviewPackage = {
      schemaVersion: '1.0',
      session: {
        id: session.id,
        name: session.name,
        startedAt: session.startedAt ?? session.createdAt,
        stoppedAt: session.stoppedAt,
        activeDurationSeconds: Math.round((session.activeElapsedMs ?? 0) / 1000),
        wallDurationSeconds: Math.round((session.wallElapsedMs ?? 0) / 1000),
      },
      timeline: reducer.reduce(entries),
    };

    const jsonExporter = new JsonExporter(this.sessionDir);
    const mdExporter = new MarkdownExporter(this.sessionDir);
    jsonExporter.export(review);
    mdExporter.export(review);

    return review;
  }

  private inputStagedEntry(buf: { label: string; startMs: number; endMs: number }): StagedEntry {
    const start = formatOffset(buf.startMs);
    const end = formatOffset(buf.endMs);
    return {
      atMs: buf.startMs,
      entry: {
        offset: start === end ? start : `${start}–${end}`,
        type: 'action',
        action: `Preencheu o campo "${buf.label}"`,
      },
    };
  }
}
