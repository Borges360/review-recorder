import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWavFromPcm, WHISPER_SAFE_CHUNK_PCM_BYTES } from '../../src/voice/WavUtils.js';
import { transcribeOfflineDetailed, transcribeWebmChunk } from '../../src/voice/OfflineTranscriber.js';

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

    const result = await transcribeOfflineDetailed(wavPath, 'test-key');
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
  });

  it('keeps the existing timestamp request for direct OpenAI chunks', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'chunk transcript' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await transcribeWebmChunk(Buffer.from('webm'), 'test-key', 2500);

    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    const body = request?.body as FormData;
    expect(body.get('model')).toBe('gpt-4o-transcribe');
    expect(body.get('response_format')).toBe('json');
    expect(body.get('timestamp_granularities[]')).toBe('segment');
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

    const result = await transcribeOfflineDetailed(wavPath, 'test-key');
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

    const result = await transcribeOfflineDetailed(wavPath, 'test-key');
    expect(result.text).toBeNull();
    expect(result.error).toContain('413');
  });
});
