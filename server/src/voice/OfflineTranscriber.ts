import { readFileSync, existsSync } from 'node:fs';
import {
  buildWavFromPcm,
  extractPcmFromWav,
  splitPcmIntoChunks,
  WHISPER_SAFE_CHUNK_PCM_BYTES,
} from './WavUtils.js';
import { parseTranscriptPayload, type RelativeSegment } from '../capture/chunkTiming.js';

export interface OfflineTranscriptionResult {
  text: string | null;
  chunksProcessed: number;
  error?: string;
}

async function transcribeWavBuffer(wavBuffer: Buffer, apiKey: string): Promise<{ text: string | null; error?: string }> {
  const formData = new FormData();
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });
  formData.append('file', blob, 'audio.wav');
  formData.append('model', 'gpt-4o-transcribe');
  formData.append('language', 'pt');

  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { text: null, error: `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}` };
    }
    const data = (await res.json()) as { text?: string };
    return { text: data.text ?? null };
  } catch (err) {
    return { text: null, error: String(err) };
  }
}

export async function transcribeOffline(
  wavPath: string,
  apiKey: string,
): Promise<string | null> {
  const result = await transcribeOfflineDetailed(wavPath, apiKey);
  return result.text;
}

export async function transcribeOfflineDetailed(
  wavPath: string,
  apiKey: string,
): Promise<OfflineTranscriptionResult> {
  if (!existsSync(wavPath)) {
    return { text: null, chunksProcessed: 0, error: 'audio file not found' };
  }

  const wavBuffer = readFileSync(wavPath);
  let pcmChunks: Buffer[];
  let sampleRate: number;
  let channels: number;
  let bitsPerSample: number;

  try {
    const parsed = extractPcmFromWav(wavBuffer);
    sampleRate = parsed.sampleRate;
    channels = parsed.channels;
    bitsPerSample = parsed.bitsPerSample;
    pcmChunks =
      parsed.pcm.length <= WHISPER_SAFE_CHUNK_PCM_BYTES
        ? [parsed.pcm]
        : splitPcmIntoChunks(parsed.pcm, WHISPER_SAFE_CHUNK_PCM_BYTES);
  } catch (err) {
    return { text: null, chunksProcessed: 0, error: String(err) };
  }

  const texts: string[] = [];
  for (let i = 0; i < pcmChunks.length; i++) {
    const chunkWav = buildWavFromPcm(pcmChunks[i]!, sampleRate, channels, bitsPerSample);
    const { text, error } = await transcribeWavBuffer(chunkWav, apiKey);
    if (text?.trim()) {
      texts.push(text.trim());
    } else if (error) {
      return {
        text: texts.length ? texts.join(' ') : null,
        chunksProcessed: i,
        error,
      };
    }
  }

  return {
    text: texts.length ? texts.join(' ') : null,
    chunksProcessed: pcmChunks.length,
  };
}

export async function transcribeWebmChunk(
  bytes: Buffer,
  apiKey: string,
  durationMs: number,
): Promise<{ segments: RelativeSegment[]; error?: string }> {
  const formData = new FormData();
  formData.append('file', new Blob([bytes], { type: 'audio/webm' }), 'chunk.webm');
  formData.append('model', 'gpt-4o-transcribe');
  formData.append('language', 'pt');
  formData.append('response_format', 'json');
  formData.append('timestamp_granularities[]', 'segment');

  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { segments: [], error: `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}` };
    }
    const data = (await res.json()) as {
      text?: string;
      segments?: { text?: string; start?: number; end?: number }[];
    };
    return { segments: parseTranscriptPayload(data, durationMs) };
  } catch (err) {
    return { segments: [], error: String(err) };
  }
}
