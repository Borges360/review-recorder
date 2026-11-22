import { buildApp } from '../../src/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const KEYS = [
  'SESSIONS_DIR',
  'DATA_DIR',
  'BROWSER_PROFILE_DIR',
  'USE_FAKE_TRANSCRIBER',
  'API_TOKEN',
  'TRANSCRIPTION_PROVIDER',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'OPENROUTER_TRANSCRIPTION_BASE_URL',
  'OPENROUTER_TRANSCRIPTION_MODEL',
  'DATABASE_URL',
  'S3_ENDPOINT',
] as const;

const root = mkdtempSync(join(tmpdir(), 'rr-transcription-'));
const previous = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

beforeAll(() => {
  for (const key of KEYS) delete process.env[key];
  process.env.SESSIONS_DIR = join(root, 'sessions');
  process.env.DATA_DIR = join(root, 'data');
  process.env.BROWSER_PROFILE_DIR = join(root, 'profile');
  process.env.USE_FAKE_TRANSCRIBER = 'false';
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ['TRANSCRIPTION_PROVIDER', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY'])
    delete process.env[key];
});

afterAll(() => {
  for (const key of KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  rmSync(root, { recursive: true, force: true });
});

async function startExtensionSession() {
  const { app } = await buildApp();
  const created = await app.inject({
    method: 'POST',
    url: '/sessions',
    payload: {
      name: 'Contrato de transcrição',
      capture: 'extension',
      initialUrl: 'https://app.example/',
    },
  });
  const session = created.json() as { id: string };
  await app.inject({ method: 'POST', url: `/sessions/${session.id}/start` });
  const sendChunk = (clientId: string) =>
    app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/audio`,
      headers: {
        'content-type': 'application/octet-stream',
        'x-client-id': clientId,
        'x-chunk-start-ms': '0',
        'x-chunk-duration-ms': '5000',
      },
      payload: Buffer.from('webm'),
    });
  return { app, sendChunk };
}

describe('HTTP transcription contract (no silent fallback)', () => {
  it('boots without TRANSCRIPTION_PROVIDER and reports the named configuration error', async () => {
    process.env.OPENAI_API_KEY = 'openai-key-must-not-be-implied';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { app, sendChunk } = await startExtensionSession();

    const config = (await app.inject({ method: 'GET', url: '/config' })).json();
    expect(config).toMatchObject({
      openaiConfigured: true,
      transcriptionConfigured: false,
      transcriptionProvider: null,
      transcriptionError:
        'transcription_config_error: TRANSCRIPTION_PROVIDER is required (openai or openrouter)',
    });

    const chunk = (await sendChunk('chunk-missing')).json();
    expect(chunk.transcribed).toBe(false);
    expect(chunk.error).toContain('TRANSCRIPTION_PROVIDER is required');
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects an invalid selector without calling any provider', async () => {
    process.env.TRANSCRIPTION_PROVIDER = 'anthropic';
    process.env.OPENAI_API_KEY = 'openai-key';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { app, sendChunk } = await startExtensionSession();

    const chunk = (await sendChunk('chunk-invalid')).json();
    expect(chunk.error).toContain('TRANSCRIPTION_PROVIDER must be openai or openrouter');
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('openrouter without OPENROUTER_API_KEY never uses the OpenAI key', async () => {
    process.env.TRANSCRIPTION_PROVIDER = 'openrouter';
    process.env.OPENAI_API_KEY = 'openai-key-must-not-fallback';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { app, sendChunk } = await startExtensionSession();

    const chunk = (await sendChunk('chunk-nokey')).json();
    expect(chunk.transcribed).toBe(false);
    expect(chunk.error).toBe(
      'transcription_config_error: OPENROUTER_API_KEY is required when TRANSCRIPTION_PROVIDER=openrouter',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('explicit openai keeps the direct OpenAI request', async () => {
    process.env.TRANSCRIPTION_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'openai-key';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: 'olá' }) });
    vi.stubGlobal('fetch', fetchMock);
    const { app, sendChunk } = await startExtensionSession();

    const chunk = (await sendChunk('chunk-openai')).json();
    expect(chunk.transcribed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(request.headers).toEqual({ Authorization: 'Bearer openai-key' });
    await app.close();
  });

  it('OpenRouter quota is terminal for the session: no retry and no switch to OpenAI', async () => {
    process.env.TRANSCRIPTION_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'router-key';
    process.env.OPENAI_API_KEY = 'openai-key-must-not-fallback';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({
          error: {
            code: 403,
            message: 'limit',
            metadata: { limit_source: 'openrouter_workspace_budget' },
          },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { app, sendChunk } = await startExtensionSession();

    const first = (await sendChunk('chunk-quota-1')).json();
    expect(first.transcribed).toBe(false);
    expect(first.error).toContain('cota OpenRouter esgotada');

    const second = (await sendChunk('chunk-quota-2')).json();
    expect(second.error).toContain('cota OpenRouter esgotada');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const [url, request] of fetchMock.mock.calls) {
      expect(url).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
      expect(request.headers).toEqual({ Authorization: 'Bearer router-key' });
    }
    await app.close();
  });
});
