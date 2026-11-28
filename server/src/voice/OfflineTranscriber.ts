import { readFileSync, existsSync } from 'node:fs';
import {
  buildWavFromPcm,
  extractPcmFromWav,
  splitPcmIntoChunks,
  WHISPER_SAFE_CHUNK_PCM_BYTES,
} from './WavUtils.js';
import { parseTranscriptPayload, type RelativeSegment } from '../capture/chunkTiming.js';
import type { TranscriptionProviderName } from '../shared/types.js';

/** Provider is always explicit: there is no implicit OpenAI default for HTTP transcription. */
export interface TranscriptionRequest {
  provider: TranscriptionProviderName;
  baseUrl: string;
  model: string;
}

/** Terminal error: the OpenRouter key/guardrail/workspace budget is exhausted. Never retried, never rerouted. */
export const OPENROUTER_QUOTA_EXHAUSTED = 'openrouter_quota_exhausted';

const OPENROUTER_BUDGET_LIMIT_SOURCES = new Set([
  'openrouter_key_limit',
  'openrouter_guardrail_budget',
  'openrouter_workspace_budget',
]);

function transcriptionEndpoint(request: TranscriptionRequest): string {
  return `${request.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;
}

function buildForm(file: Blob, filename: string, request: TranscriptionRequest): FormData {
  const formData = new FormData();
  formData.append('file', file, filename);
  formData.append('model', request.model);
  formData.append('language', 'pt');
  if (request.provider === 'openrouter') {
    // The OpenRouter STT endpoint accepts provider preferences as a JSON-encoded multipart field.
    // Pin the routed provider so a failure never silently moves the request elsewhere.
    formData.append('provider', JSON.stringify({ allow_fallbacks: false }));
  }
  return formData;
}

interface HttpErrorResponse {
  status: number;
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
}

interface TranscriptionHttpError {
  error: string;
  quotaExhausted?: true;
}

/**
 * OpenRouter budget exhaustion: HTTP 402 without Retry-After, or 403 whose `error.metadata.limit_source`
 * names a key, guardrail or workspace budget. Returns the limit source (or `credits` for 402).
 */
export function openRouterQuotaSource(status: number, retryAfter: string | null, body: string): string | null {
  if (status === 402 && !retryAfter) return 'credits';
  if (status !== 403) return null;
  try {
    const parsed = JSON.parse(body) as { error?: { metadata?: { limit_source?: unknown } } };
    const source = parsed.error?.metadata?.limit_source;
    return typeof source === 'string' && OPENROUTER_BUDGET_LIMIT_SOURCES.has(source) ? source : null;
  } catch {
    return null;
  }
}

async function describeHttpError(res: HttpErrorResponse, request: TranscriptionRequest): Promise<TranscriptionHttpError> {
  const body = await res.text().catch(() => '');
  if (request.provider === 'openrouter') {
    const source = openRouterQuotaSource(res.status, res.headers?.get('retry-after') ?? null, body);
    if (source) {
      return {
        error: `${OPENROUTER_QUOTA_EXHAUSTED}: cota OpenRouter esgotada (HTTP ${res.status}, limit_source=${source})`,
        quotaExhausted: true,
      };
    }
  }
  return { error: `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}` };
}

export interface OfflineTranscriptionResult {
  text: string | null;
  chunksProcessed: number;
  /** Seconds of audio sent to the provider (for usage/cost). */
  audioSeconds?: number;
  error?: string;
  /** Set when the OpenRouter budget is exhausted; callers must not retry nor switch provider. */
  quotaExhausted?: true;
}

async function transcribeWavBuffer(
  wavBuffer: Buffer,
  apiKey: string,
  request: TranscriptionRequest,
): Promise<{ text: string | null; error?: string; quotaExhausted?: true }> {
  const formData = buildForm(new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav', request);

  try {
    const res = await fetch(transcriptionEndpoint(request), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });
    if (!res.ok) {
      return { text: null, ...(await describeHttpError(res, request)) };
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
  request: TranscriptionRequest,
): Promise<string | null> {
  const result = await transcribeOfflineDetailed(wavPath, apiKey, request);
  return result.text;
}

export async function transcribeOfflineDetailed(
  wavPath: string,
  apiKey: string,
  request: TranscriptionRequest,
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

  const audioSeconds = pcmChunks.reduce((sum, c) => sum + c.length, 0) / (sampleRate * channels * (bitsPerSample / 8));
  const texts: string[] = [];
  for (let i = 0; i < pcmChunks.length; i++) {
    const chunkWav = buildWavFromPcm(pcmChunks[i]!, sampleRate, channels, bitsPerSample);
    const { text, error, quotaExhausted } = await transcribeWavBuffer(chunkWav, apiKey, request);
    if (text?.trim()) {
      texts.push(text.trim());
    } else if (error) {
      return {
        text: texts.length ? texts.join(' ') : null,
        chunksProcessed: i,
        audioSeconds,
        error,
        ...(quotaExhausted ? { quotaExhausted } : {}),
      };
    }
  }

  return {
    text: texts.length ? texts.join(' ') : null,
    chunksProcessed: pcmChunks.length,
    audioSeconds,
  };
}

export async function transcribeWebmChunk(
  bytes: Buffer,
  apiKey: string,
  durationMs: number,
  request: TranscriptionRequest,
): Promise<{ segments: RelativeSegment[]; error?: string; quotaExhausted?: true }> {
  const formData = buildForm(new Blob([bytes], { type: 'audio/webm' }), 'chunk.webm', request);
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
      return { segments: [], ...(await describeHttpError(res, request)) };
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
