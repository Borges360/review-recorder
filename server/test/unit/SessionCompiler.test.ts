import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SessionCompiler } from '../../src/export/SessionCompiler.js';
import { SessionRepository } from '../../src/persistence/SessionRepository.js';
import { EVENT_TYPES } from '../../src/shared/events.js';

describe('SessionCompiler', () => {
  const dataDir = join(process.cwd(), 'test-data-session-compiler');
  const sessionsDir = join(process.cwd(), 'test-sessions-session-compiler');
  let repo: SessionRepository;
  let sessionId: string;
  let sessionDir: string;

  beforeEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(sessionsDir, { recursive: true, force: true });
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    repo = new SessionRepository(dataDir);
    sessionId = randomUUID();
    sessionDir = join(sessionsDir, 'test-session');
    mkdirSync(join(sessionDir, 'raw'), { recursive: true });

    repo.createSession({
      id: sessionId,
      name: 'Test',
      slug: 'test',
      initialUrl: null,
      description: null,
      status: 'COMPLETED',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
      outputDir: sessionDir,
      wallElapsedMs: 72000,
      activeElapsedMs: 72000,
      diagnosticTrace: false,
    });
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  function appendEvent(type: string, activeElapsedMs: number, payload: Record<string, unknown>): void {
    writeFileSync(
      join(sessionDir, 'raw', 'events.jsonl'),
      JSON.stringify({
        type,
        payload,
        timestamp: new Date().toISOString(),
        elapsedMs: activeElapsedMs,
        activeElapsedMs,
        sessionId,
        sequence: activeElapsedMs,
      }) + '\n',
      { flag: 'a' },
    );
  }

  it('places observations at speech start time with correlated screen state', async () => {
    appendEvent(EVENT_TYPES.SESSION_STARTED, 6, { name: 'Test' });
    appendEvent(EVENT_TYPES.SCREEN_STATE_CHANGED, 955, {
      stateId: 'state-dashboard',
      title: 'Dashboard',
      url: 'http://localhost:8080/dashboard',
    });
    appendEvent(EVENT_TYPES.CLICK, 17730, {
      target: { accessibleName: 'Comercial e contratos', text: 'Comercial e contratos' },
    });
    appendEvent(EVENT_TYPES.SCREEN_STATE_CHANGED, 21636, {
      stateId: 'state-production',
      title: 'Produção Editorial',
      url: 'http://localhost:8080/dashboard',
    });
    appendEvent(EVENT_TYPES.SCREEN_STATE_CHANGED, 55778, {
      stateId: 'state-comms',
      title: 'Comunicação',
      url: 'http://localhost:8080/communications',
    });
    appendEvent(EVENT_TYPES.TRANSCRIPT_FINAL, 72853, {
      segment: {
        id: 'speech-1',
        text: 'Esses caracteres esquisitos têm que ser corrigidos.',
        startedAtMs: 19000,
        endedAtMs: 24000,
        screenStateId: 'state-dashboard',
        scope: 'SCREEN',
        associationConfidence: 'LOW',
        candidateElement: null,
      },
    });

    const compiler = new SessionCompiler(sessionDir, repo);
    const review = await compiler.compile(sessionId);

    const observations = review.timeline.filter((e) => e.type === 'observation');
    expect(observations).toHaveLength(1);
    expect(observations[0]?.offset).toBe('00:19.000');
    expect((observations[0]?.screen as { title?: string }).title).toBe('Dashboard');

    const clickIdx = review.timeline.findIndex((e) => e.type === 'action' && e.action?.includes('Comercial'));
    const obsIdx = review.timeline.findIndex((e) => e.type === 'observation');
    expect(obsIdx).toBeGreaterThan(clickIdx);
    const productionIdx = review.timeline.findIndex(
      (e) => e.type === 'screen' && (e.screen as { title?: string }).title === 'Produção Editorial',
    );
    expect(obsIdx).toBeLessThan(productionIdx);
  });
});
