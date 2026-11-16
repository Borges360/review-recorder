import { readFileSync, existsSync } from 'node:fs';
import {
  buildWavFromPcm,
  extractPcmFromWav,
  splitPcmIntoChunks,
  WHISPER_SAFE_CHUNK_PCM_BYTES,
} from './WavUtils.js';
import { parseTranscriptPayload, type RelativeSegment } from '../capture/chunkTiming.js';
import type { TranscriptionConfig } from '../shared/types.js';
import {
  OPENAI_TRANSCRIPTION_BASE_URL,
  OPENAI_TRANSCRIPTION_MODEL,
} from './transcriptionProvider.js';

export type TranscriptionRequest = Pick<TranscriptionConfig, 'provider' | 'baseUrl' | 'model'>;

function transcriptionEndpoint(request: TranscriptionRequest): string {
  return `${request.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;
}

export interface OfflineTranscriptionResult {
  text: string | null;
  chunksProcessed: number;
  error?: string;
}

async function transcribeWavBuffer(
  wavBuffer: Buffer,
  apiKey: string,
  request: TranscriptionRequest,
): Promise<{ text: string | null; error?: string }> {
  const formData = new FormData();
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });
  formData.append('file', blob, 'audio.wav');
  formData.append('model', request.model);
  formData.append('language', 'pt');

  try {
    const res = await fetch(transcriptionEndpoint(request), {
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
  request: TranscriptionRequest = {
    provider: 'openai',
    baseUrl: OPENAI_TRANSCRIPTION_BASE_URL,
    model: OPENAI_TRANSCRIPTION_MODEL,
  },
): Promise<string | null> {
  const result = await transcribeOfflineDetailed(wavPath, apiKey, request);
  return result.text;
}

export async function transcribeOfflineDetailed(
  wavPath: string,
  apiKey: string,
  request: TranscriptionRequest = {
    provider: 'openai',
    baseUrl: OPENAI_TRANSCRIPTION_BASE_URL,
    model: OPENAI_TRANSCRIPTION_MODEL,
  },
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
    const { text, error } = await transcribeWavBuffer(chunkWav, apiKey, request);
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
  request: TranscriptionRequest = {
    provider: 'openai',
    baseUrl: OPENAI_TRANSCRIPTION_BASE_URL,
    model: OPENAI_TRANSCRIPTION_MODEL,
  },
): Promise<{ segments: RelativeSegment[]; error?: string }> {
  const formData = new FormData();
  formData.append('file', new Blob([bytes], { type: 'audio/webm' }), 'chunk.webm');
  formData.append('model', request.model);
  formData.append('language', 'pt');
  formData.append('response_format', 'json');
  if (request.provider === 'openai') {
    formData.append('timestamp_granularities[]', 'segment');
  }

  try {
    const res = await fetch(transcriptionEndpoint(request), {
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
