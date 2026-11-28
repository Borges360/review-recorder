import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { LlmService } from '../../src/llm/LlmService.js';
import { MemoryLlmPersistence } from '../../src/llm/persistence.js';
import { SessionManager } from '../../src/session/SessionManager.js';
import { getTranscriber } from '../../src/voice/Transcriber.js';
import { EVENT_TYPES } from '../../src/shared/events.js';

vi.mock('../../src/voice/Transcriber.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/voice/Transcriber.js')>();
  return { ...original, getTranscriber: vi.fn() };
});

const root = mkdtempSync(join(tmpdir(), 'rr-realtime-budget-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fakeRealtime() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    appendAudio: vi.fn(),
    commitBuffer: vi.fn(),
    getAudioMsWritten: vi.fn().mockReturnValue(0),
    disconnect: vi.fn(),
  };
}

async function harness(opts: { listUsage?: () => Promise<never> } = {}) {
  const persistence = new MemoryLlmPersistence();
  if (opts.listUsage) persistence.listUsage = opts.listUsage as never;
  const llm = await LlmService.create({ env: { OPENAI_API_KEY: 'sk-test-SECRET' }, persistence, now: () => new Date('2026-11-15T12:00:00Z') });
  const transcriber = fakeRealtime();
  vi.mocked(getTranscriber).mockReturnValue({ realtime: () => transcriber } as never);
  const sessions = Object.create(SessionManager.prototype) as SessionManager & Record<string, unknown>;
  (sessions as Record<string, unknown>).llm = llm;
  (sessions as Record<string, unknown>).config = { useFakeTranscriber: false };
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  (sessions as Record<string, unknown>).emitEvent = (_a: unknown, type: string, payload: Record<string, unknown>) => events.push({ type, payload });
  const active = {
    record: { id: 's1' },
    artifacts: { getAudioPath: () => join(root, `audio-${Math.random()}.pcm`) },
    stopping: false,
    transcriber: null as unknown,
    realtimeRoute: null as unknown,
  };
  (sessions as unknown as { setupVoice(a: unknown): void }).setupVoice(active);
  return { llm, sessions, transcriber, active, events };
}

describe('transcrição realtime e orçamento', () => {
  it('o transcriber é atribuído de forma síncrona: nenhum áudio inicial é descartado', async () => {
    const { active, transcriber } = await harness();
    expect(active.transcriber).toBe(transcriber);
    expect(active.realtimeRoute).toMatchObject({ provider: 'openai', model: 'gpt-live-transcribe' });
    expect(transcriber.connect).toHaveBeenCalledTimes(1);
  });

  it('teto em block já excedido derruba o realtime e avisa budget_exceeded', async () => {
    const persistence = new MemoryLlmPersistence();
    const llm = await LlmService.create({ env: { OPENAI_API_KEY: 'sk-test-SECRET' }, persistence, now: () => new Date('2026-11-15T12:00:00Z') });
    await llm.update({ budget: { monthlyUsd: 0, action: 'block' } });
    const transcriber = fakeRealtime();
    vi.mocked(getTranscriber).mockReturnValue({ realtime: () => transcriber } as never);
    const sessions = Object.create(SessionManager.prototype) as Record<string, unknown>;
    sessions.llm = llm;
    sessions.config = { useFakeTranscriber: false };
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    sessions.emitEvent = (_a: unknown, type: string, payload: Record<string, unknown>) => events.push({ type, payload });
    const active = { record: { id: 's2' }, artifacts: { getAudioPath: () => join(root, 'a2.pcm') }, stopping: false, transcriber: null as unknown, realtimeRoute: null as unknown };
    (sessions as unknown as { setupVoice(a: unknown): void }).setupVoice(active);
    await vi.waitFor(() => expect(active.transcriber).toBeNull());
    expect(transcriber.disconnect).toHaveBeenCalled();
    expect(active.realtimeRoute).toBeNull();
    expect(events).toContainEqual({ type: EVENT_TYPES.TRANSCRIPTION_OFFLINE, payload: { reason: 'budget_exceeded' } });
  });

  it('banco de uso fora do ar não gera rejeição não tratada nem derruba o realtime', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { llm, active, transcriber } = await harness({ listUsage: () => Promise.reject(new Error('db down')) });
    await llm.update({ budget: { monthlyUsd: 1, action: 'block' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(unhandled).not.toHaveBeenCalled();
    expect(active.transcriber).toBe(transcriber);
    expect(transcriber.disconnect).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
    warn.mockRestore();
  });
});
