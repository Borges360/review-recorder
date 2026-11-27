import { describe, it, expect } from 'vitest';
import {
  buildWavFromPcm,
  extractPcmFromWav,
  pcmDurationMs,
  splitPcmIntoChunks,
  WHISPER_SAFE_CHUNK_PCM_BYTES,
  WAV_HEADER_SIZE,
} from '../../src/voice/WavUtils.js';

describe('WavUtils', () => {
  it('round-trips PCM through WAV header', () => {
    const pcm = Buffer.alloc(4800, 0);
    const wav = buildWavFromPcm(pcm, 24000, 1, 16);
    expect(wav.length).toBe(WAV_HEADER_SIZE + pcm.length);
    const parsed = extractPcmFromWav(wav);
    expect(parsed.pcm.equals(pcm)).toBe(true);
    expect(parsed.sampleRate).toBe(24000);
  });

  it('splits large PCM into chunks under the safe limit', () => {
    const pcm = Buffer.alloc(WHISPER_SAFE_CHUNK_PCM_BYTES * 2 + 1000);
    const chunks = splitPcmIntoChunks(pcm, WHISPER_SAFE_CHUNK_PCM_BYTES);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.length).toBe(WHISPER_SAFE_CHUNK_PCM_BYTES);
    expect(chunks[1]!.length).toBe(WHISPER_SAFE_CHUNK_PCM_BYTES);
    expect(chunks[2]!.length).toBe(1000);
  });

  it('computes PCM duration in milliseconds', () => {
    const pcm = Buffer.alloc(48000);
    expect(pcmDurationMs(pcm, 24000, 1, 16)).toBe(1000);
  });
});
