import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWavFromPcm, WHISPER_SAFE_CHUNK_PCM_BYTES } from '../../src/voice/WavUtils.js';
import {
  openRouterQuotaSource,
  transcribeOfflineDetailed,
  transcribeWebmChunk,
} from '../../src/voice/OfflineTranscriber.js';

const openai = {
  provider: 'openai' as const,
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-transcribe',
};
const openrouter = {
  provider: 'openrouter' as const,
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'openai/gpt-4o-transcribe',
};

function errorResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: false,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('OfflineTranscriber', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'offline-transcriber-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('transcribes a small WAV in a single request', async () => {
    const pcm = Buffer.alloc(4800);
    const wav = buildWavFromPcm(pcm, 24000, 1, 16);
    const wavPath = join(tempDir, 'audio.wav');
    writeFileSync(wavPath, wav);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'hello world' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await transcribeOfflineDetailed(wavPath, 'test-key', openai);
    expect(result.text).toBe('hello world');
    expect(result.chunksProcessed).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(request?.headers).toEqual({ Authorization: 'Bearer test-key' });
    expect((request?.body as FormData).get('model')).toBe('gpt-4o-transcribe');
  });

  it('routes offline WAV transcription through the explicitly selected provider config', async () => {
    const pcm = Buffer.alloc(4800);
    const wav = buildWavFromPcm(pcm, 24000, 1, 16);
    const wavPath = join(tempDir, 'router-audio.wav');
    writeFileSync(wavPath, wav);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'router transcript' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const transcription = {
      provider: 'openrouter' as const,
      apiKey: 'router-test-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-4o-transcribe',
    };
    const result = await transcribeOfflineDetailed(wavPath, transcription.apiKey, transcription);

    expect(result.text).toBe('router transcript');
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
    expect(request?.headers).toEqual({ Authorization: 'Bearer router-test-key' });
    expect((request?.body as FormData).get('model')).toBe('openai/gpt-4o-transcribe');
    expect(JSON.parse((request?.body as FormData).get('provider') as string)).toEqual({ allow_fallbacks: false });
  });

  it('routes WebM chunks while keeping the existing coarse timing fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'chunk transcript' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const transcription = {
      provider: 'openrouter' as const,
      apiKey: 'router-test-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-4o-transcribe',
    };
    const result = await transcribeWebmChunk(Buffer.from('webm'), transcription.apiKey, 2500, transcription);

    expect(result).toEqual({ segments: [{ text: 'chunk transcript', startMs: 0, endMs: 2500 }] });
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
    expect(request?.headers).toEqual({ Authorization: 'Bearer router-test-key' });
    const body = request?.body as FormData;
    expect(body.get('model')).toBe('openai/gpt-4o-transcribe');
    expect(body.get('response_format')).toBe('json');
    expect(body.get('timestamp_granularities[]')).toBeNull();
    expect(JSON.parse(body.get('provider') as string)).toEqual({ allow_fallbacks: false });
  });

  it('keeps the existing timestamp request for direct OpenAI chunks', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'chunk transcript' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await transcribeWebmChunk(Buffer.from('webm'), 'test-key', 2500, openai);

    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    const body = request?.body as FormData;
    expect(body.get('model')).toBe('gpt-4o-transcribe');
    expect(body.get('response_format')).toBe('json');
    expect(body.get('timestamp_granularities[]')).toBe('segment');
    expect(body.get('provider')).toBeNull();
  });

  it('chunks large WAV files into multiple requests', async () => {
    const pcm = Buffer.alloc(WHISPER_SAFE_CHUNK_PCM_BYTES * 2 + 500);
    const wav = buildWavFromPcm(pcm, 24000, 1, 16);
    const wavPath = join(tempDir, 'large-audio.wav');
    writeFileSync(wavPath, wav);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ text: 'part one' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ text: 'part two' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ text: 'part three' }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await transcribeOfflineDetailed(wavPath, 'test-key', openai);
    expect(result.text).toBe('part one part two part three');
    expect(result.chunksProcessed).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns error details when API rejects a chunk', async () => {
    const pcm = Buffer.alloc(4800);
    const wav = buildWavFromPcm(pcm, 24000, 1, 16);
    const wavPath = join(tempDir, 'fail.wav');
    writeFileSync(wavPath, wav);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 413,
        text: async () => 'payload too large',
      }),
    );

    const result = await transcribeOfflineDetailed(wavPath, 'test-key', openai);
    expect(result.text).toBeNull();
    expect(result.error).toContain('413');
  });

  describe('OpenRouter quota', () => {
    it('classifies 402 without Retry-After and budget 403 as quota; everything else is not', () => {
      expect(openRouterQuotaSource(402, null, '')).toBe('credits');
      expect(openRouterQuotaSource(402, '30', '')).toBeNull();
      for (const source of ['openrouter_key_limit', 'openrouter_guardrail_budget', 'openrouter_workspace_budget']) {
        expect(openRouterQuotaSource(403, null, JSON.stringify({ error: { metadata: { limit_source: source } } }))).toBe(
          source,
        );
      }
      expect(openRouterQuotaSource(403, null, JSON.stringify({ error: { metadata: { limit_source: 'other' } } }))).toBeNull();
      expect(openRouterQuotaSource(403, null, 'not json')).toBeNull();
      expect(openRouterQuotaSource(429, null, '')).toBeNull();
    });

    it('402 is terminal: one request, no retry, no switch to OpenAI', async () => {
      const fetchMock = vi.fn().mockResolvedValue(errorResponse(402, { error: { code: 402, message: 'no credits' } }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await transcribeWebmChunk(Buffer.from('webm'), 'router-key', 2500, openrouter);

      expect(result.segments).toEqual([]);
      expect(result.quotaExhausted).toBe(true);
      expect(result.error).toContain('cota OpenRouter esgotada');
      expect(result.error).toContain('openrouter_quota_exhausted');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]![0]).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
    });

    it('402 with Retry-After is a regular error, not quota', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(402, 'busy', { 'retry-after': '10' })));
      const result = await transcribeWebmChunk(Buffer.from('webm'), 'router-key', 2500, openrouter);
      expect(result.quotaExhausted).toBeUndefined();
      expect(result.error).toBe('HTTP 402: busy');
    });

    it('budget 403 stops offline transcription at the first chunk', async () => {
      const pcm = Buffer.alloc(WHISPER_SAFE_CHUNK_PCM_BYTES * 2 + 500);
      const wavPath = join(tempDir, 'quota.wav');
      writeFileSync(wavPath, buildWavFromPcm(pcm, 24000, 1, 16));
      const fetchMock = vi.fn().mockResolvedValue(
        errorResponse(403, { error: { code: 403, message: 'limit', metadata: { limit_source: 'openrouter_key_limit' } } }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const result = await transcribeOfflineDetailed(wavPath, 'router-key', openrouter);

      expect(result.text).toBeNull();
      expect(result.chunksProcessed).toBe(0);
      expect(result.quotaExhausted).toBe(true);
      expect(result.error).toContain('limit_source=openrouter_key_limit');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('never classifies OpenAI errors as OpenRouter quota', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(402, 'billing')));
      const result = await transcribeWebmChunk(Buffer.from('webm'), 'test-key', 2500, openai);
      expect(result.quotaExhausted).toBeUndefined();
      expect(result.error).toBe('HTTP 402: billing');
    });
  });
});
