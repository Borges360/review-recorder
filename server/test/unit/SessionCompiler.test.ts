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

  it('interleaves multiple speech blocks with clicks by startedAtMs', async () => {
    appendEvent(EVENT_TYPES.SESSION_STARTED, 0, { name: 'Test' });
    appendEvent(EVENT_TYPES.SCREEN_STATE_CHANGED, 1000, {
      stateId: 'state-login',
      title: 'Login',
      url: 'http://localhost/login',
    });
    appendEvent(EVENT_TYPES.TRANSCRIPT_FINAL, 7000, {
      segment: {
        id: 'speech-1',
        text: 'Nessa página o botão visualizar',
        startedAtMs: 0,
        endedAtMs: 7000,
        screenStateId: 'state-login',
        scope: 'SCREEN',
        associationConfidence: 'LOW',
        candidateElement: null,
      },
    });
    appendEvent(EVENT_TYPES.CLICK, 7000, {
      target: { accessibleName: 'E-mail', text: 'E-mail' },
    });
    appendEvent(EVENT_TYPES.TRANSCRIPT_FINAL, 13000, {
      segment: {
        id: 'speech-2',
        text: 'esse campo está fora do padrão',
        startedAtMs: 7000,
        endedAtMs: 13000,
        screenStateId: 'state-login',
        scope: 'ELEMENT',
        associationConfidence: 'HIGH',
        candidateElement: { accessibleName: 'E-mail', role: 'textbox' },
      },
    });
    appendEvent(EVENT_TYPES.CLICK, 13000, {
      target: { accessibleName: 'Entrar', text: 'Entrar' },
    });
    appendEvent(EVENT_TYPES.SCREEN_STATE_CHANGED, 16000, {
      stateId: 'state-dashboard',
      title: 'Dashboard',
      url: 'http://localhost/dashboard',
    });
    appendEvent(EVENT_TYPES.TRANSCRIPT_FINAL, 20000, {
      segment: {
        id: 'speech-3',
        text: 'no dashboard tudo parece ok',
        startedAtMs: 13000,
        endedAtMs: 20000,
        screenStateId: 'state-login',
        scope: 'ELEMENT',
        associationConfidence: 'HIGH',
        candidateElement: { accessibleName: 'Entrar', role: 'button' },
      },
    });

    const compiler = new SessionCompiler(sessionDir, repo);
    const review = await compiler.compile(sessionId);

    const observations = review.timeline.filter((e) => e.type === 'observation');
    expect(observations).toHaveLength(3);
    expect(observations[0]?.offset).toBe('00:00.000');
    expect(observations[1]?.offset).toBe('00:07.000');
    expect(observations[2]?.offset).toBe('00:13.000');

    const obs0Idx = review.timeline.findIndex(
      (e) => e.type === 'observation' && e.offset === '00:00.000',
    );
    const click1Idx = review.timeline.findIndex(
      (e) => e.type === 'action' && (e.action as string)?.includes('E-mail'),
    );
    const obs1Idx = review.timeline.findIndex(
      (e) => e.type === 'observation' && e.offset === '00:07.000',
    );
    const click2Idx = review.timeline.findIndex(
      (e) => e.type === 'action' && (e.action as string)?.includes('Entrar'),
    );
    const obs2Idx = review.timeline.findIndex(
      (e) => e.type === 'observation' && e.offset === '00:13.000',
    );

    expect(obs0Idx).toBeLessThan(click1Idx);
    expect(click1Idx).toBeLessThan(obs1Idx);
    expect(obs1Idx).toBeLessThan(click2Idx);
    expect(click2Idx).toBeLessThan(obs2Idx);
  });
});
