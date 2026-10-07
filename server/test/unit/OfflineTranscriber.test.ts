import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWavFromPcm, WHISPER_SAFE_CHUNK_PCM_BYTES } from '../../src/voice/WavUtils.js';
import { transcribeOfflineDetailed } from '../../src/voice/OfflineTranscriber.js';

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
