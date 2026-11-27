export const WAV_HEADER_SIZE = 44;

/** PCM payload limit per Whisper upload (25 MB file cap minus header margin). */
export const WHISPER_SAFE_CHUNK_PCM_BYTES = 20 * 1024 * 1024;

export interface WavPcm {
  pcm: Buffer;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

export function extractPcmFromWav(wav: Buffer): WavPcm {
  if (wav.length < WAV_HEADER_SIZE || wav.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('Invalid WAV file');
  }
  return {
    pcm: wav.subarray(WAV_HEADER_SIZE),
    sampleRate: wav.readUInt32LE(24),
    channels: wav.readUInt16LE(22),
    bitsPerSample: wav.readUInt16LE(34),
  };
}

export function buildWavFromPcm(
  pcm: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): Buffer {
  const header = Buffer.alloc(WAV_HEADER_SIZE);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bitsPerSample) / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function splitPcmIntoChunks(pcm: Buffer, maxChunkBytes: number): Buffer[] {
  if (maxChunkBytes <= 0) throw new Error('maxChunkBytes must be positive');
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < pcm.length; offset += maxChunkBytes) {
    chunks.push(pcm.subarray(offset, Math.min(offset + maxChunkBytes, pcm.length)));
  }
  return chunks;
}

export function pcmDurationMs(pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number): number {
  const bytesPerSecond = (sampleRate * channels * bitsPerSample) / 8;
  return Math.floor((pcm.length / bytesPerSecond) * 1000);
}
