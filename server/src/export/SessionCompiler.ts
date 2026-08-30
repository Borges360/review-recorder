import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { EventEnvelope, ReviewPackage, TimelineEntry } from '../shared/types.js';
import { formatOffset } from '../shared/redaction.js';
import { EVENT_TYPES } from '../shared/events.js';
import type { SessionRepository } from '../persistence/SessionRepository.js';
import { JsonExporter } from './JsonExporter.js';
import { MarkdownExporter } from './MarkdownExporter.js';
import { TimelineReducer } from '../timeline/TimelineReducer.js';

export class SessionCompiler {
  constructor(
    private readonly sessionDir: string,
    private readonly repo: SessionRepository,
  ) {}

  async compile(sessionId: string): Promise<ReviewPackage> {
    const session = this.repo.getSession(sessionId);
    if (!session) throw new Error('Session not found');

    const eventsPath = `${this.sessionDir}/raw/events.jsonl`;
    const entries: TimelineEntry[] = [];
    let lastScreenTitle = '';
    let lastScreenUrl = '';
    let lastScreenId = '';
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
          entries.push({
            id: `tl-${entries.length}`,
            offset,
            type: 'session',
            label: 'SESSION START',
            name: payload.name,
          });
          break;

        case EVENT_TYPES.SESSION_PAUSED:
          entries.push({ id: `tl-${entries.length}`, offset, type: 'pause', label: 'PAUSE' });
          break;

        case EVENT_TYPES.SESSION_RESUMED:
          entries.push({ id: `tl-${entries.length}`, offset, type: 'resume', label: 'RESUME' });
          break;

        case EVENT_TYPES.SCREEN_STATE_CREATED:
        case EVENT_TYPES.SCREEN_STATE_CHANGED: {
          lastScreenTitle = (payload.title as string) ?? lastScreenTitle;
          lastScreenUrl = (payload.url as string) ?? lastScreenUrl;
          lastScreenId = (payload.stateId as string) ?? lastScreenId;
          entries.push({
            id: `tl-${entries.length}`,
            offset,
            type: 'screen',
            screen: { id: lastScreenId, url: lastScreenUrl, title: lastScreenTitle },
          });
          inputBuffer = null;
          break;
        }

        case EVENT_TYPES.CLICK: {
          inputBuffer = null;
          const target = payload.target as Record<string, unknown> | null;
          const name = target?.accessibleName ?? target?.text ?? 'elemento';
          entries.push({
            id: `tl-${entries.length}`,
            offset,
            type: 'action',
            action: `Click "${name}"`,
            target,
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
              entries.push(this.inputEntry(inputBuffer, entries.length));
            }
            inputBuffer = { label, startMs: event.activeElapsedMs, endMs: event.activeElapsedMs };
          }
          break;
        }

        case EVENT_TYPES.FORM_SUBMITTED:
          if (inputBuffer) {
            entries.push(this.inputEntry(inputBuffer, entries.length));
            inputBuffer = null;
          }
          entries.push({
            id: `tl-${entries.length}`,
            offset,
            type: 'action',
            action: 'Submit formulário',
          });
          break;

        case EVENT_TYPES.TRANSCRIPT_FINAL: {
          if (inputBuffer) {
            entries.push(this.inputEntry(inputBuffer, entries.length));
            inputBuffer = null;
          }
          const segment = payload.segment as Record<string, unknown>;
          entries.push({
            id: `tl-${entries.length}`,
            offset,
            type: 'observation',
            scope: segment.scope,
            speech: { text: segment.text },
            screen: { id: lastScreenId, url: lastScreenUrl, title: lastScreenTitle },
            candidateElement: segment.candidateElement,
            associationConfidence: segment.associationConfidence,
          });
          break;
        }

        case EVENT_TYPES.SCREENSHOT_CAPTURED: {
          const evidence = payload.evidence as Record<string, unknown>;
          entries.push({
            id: `tl-${entries.length}`,
            offset,
            type: 'evidence',
            evidence: [{ type: 'screenshot', path: evidence.file }],
            screen: { id: lastScreenId, url: lastScreenUrl, title: lastScreenTitle },
          });
          break;
        }
      }
    }

    if (inputBuffer) {
      entries.push(this.inputEntry(inputBuffer, entries.length));
    }

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

  private inputEntry(buf: { label: string; startMs: number; endMs: number }, idx: number): TimelineEntry {
    const start = formatOffset(buf.startMs);
    const end = formatOffset(buf.endMs);
    return {
      id: `tl-${idx}`,
      offset: start === end ? start : `${start}–${end}`,
      type: 'action',
      action: `Preencheu o campo "${buf.label}"`,
    };
  }
}
