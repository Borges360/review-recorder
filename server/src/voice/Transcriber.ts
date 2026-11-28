import type { ProviderId, ResolvedRoute } from '../llm/types.js';
import type { RelativeSegment } from '../capture/chunkTiming.js';
import { transcribeOfflineDetailed, transcribeWebmChunk, type OfflineTranscriptionResult } from './OfflineTranscriber.js';
import { OpenAITranscriber, type RealtimeTranscriber, type TranscriberCallbacks } from './OpenAITranscriber.js';

export type TranscriberRoute = Pick<ResolvedRoute, 'provider' | 'baseUrl' | 'model' | 'apiKey'>;

export interface TranscriberCapabilities {
  offline: boolean;
  realtime: boolean;
}

/** Thrown when a provider is asked for something it cannot do (never silently faked). */
export class UnsupportedCapabilityError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly capability: keyof TranscriberCapabilities,
  ) {
    super(`${provider} does not support ${capability} transcription`);
  }
}

/** Speech-to-text provider adapter: offline (WAV file / WebM chunk) and realtime (PCM stream). */
export interface Transcriber {
  readonly provider: ProviderId;
  readonly capabilities: TranscriberCapabilities;
  offline(wavPath: string, route: TranscriberRoute): Promise<OfflineTranscriptionResult>;
  offlineChunk(
    bytes: Buffer,
    durationMs: number,
    route: TranscriberRoute,
  ): Promise<{ segments: RelativeSegment[]; error?: string }>;
  realtime(route: TranscriberRoute, callbacks: TranscriberCallbacks): RealtimeTranscriber;
}

function requireKey(route: TranscriberRoute): string {
  if (!route.apiKey) throw new Error('no_api_key');
  return route.apiKey;
}

function offlineRequest(route: TranscriberRoute, provider: 'openai' | 'openrouter') {
  return { provider, baseUrl: route.baseUrl, model: route.model };
}

/** Both OpenAI and OpenRouter expose POST {base}/audio/transcriptions (multipart). */
function createHttpTranscriber(
  provider: 'openai' | 'openrouter',
  capabilities: TranscriberCapabilities,
): Transcriber {
  return {
    provider,
    capabilities,
    offline: (wavPath, route) =>
      transcribeOfflineDetailed(wavPath, requireKey(route), offlineRequest(route, provider)),
    offlineChunk: (bytes, durationMs, route) =>
      transcribeWebmChunk(bytes, requireKey(route), durationMs, offlineRequest(route, provider)),
    realtime(route, callbacks) {
      if (!capabilities.realtime) throw new UnsupportedCapabilityError(provider, 'realtime');
      return new OpenAITranscriber(requireKey(route), callbacks, route.model);
    },
  };
}

const openai = createHttpTranscriber('openai', { offline: true, realtime: true });
// OpenRouter has no realtime transcription socket: offline/chunked only.
const openrouter = createHttpTranscriber('openrouter', { offline: true, realtime: false });

// Anthropic offers no speech-to-text. The adapter exists only to declare that, loudly.
const anthropic: Transcriber = {
  provider: 'anthropic',
  capabilities: { offline: false, realtime: false },
  offline() {
    throw new UnsupportedCapabilityError('anthropic', 'offline');
  },
  offlineChunk() {
    throw new UnsupportedCapabilityError('anthropic', 'offline');
  },
  realtime() {
    throw new UnsupportedCapabilityError('anthropic', 'realtime');
  },
};

const TRANSCRIBERS: Record<ProviderId, Transcriber> = { openai, openrouter, anthropic };

export function getTranscriber(provider: ProviderId): Transcriber {
  return TRANSCRIBERS[provider];
}
