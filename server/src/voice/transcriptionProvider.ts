import type { AppConfig, TranscriptionConfig } from '../shared/types.js';

export const OPENAI_TRANSCRIPTION_BASE_URL = 'https://api.openai.com/v1';
export const OPENAI_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';
export const OPENROUTER_TRANSCRIPTION_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_TRANSCRIPTION_MODEL = 'openai/gpt-4o-transcribe';

function apiKey(value: string | undefined): string | null {
  return value?.trim() || null;
}

export function secureBaseUrl(value: string | undefined, fallback: string): string {
  const baseUrl = (value?.trim() || fallback).replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('Transcription provider base URL must be a valid HTTPS URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Transcription provider base URL must use HTTPS');
  }
  return baseUrl;
}

export function resolveTranscriptionConfig(env: NodeJS.ProcessEnv): TranscriptionConfig {
  const provider = env.TRANSCRIPTION_PROVIDER?.trim().toLowerCase() || 'openai';
  if (provider !== 'openai' && provider !== 'openrouter') {
    throw new Error('TRANSCRIPTION_PROVIDER must be openai or openrouter');
  }

  if (provider === 'openrouter') {
    return {
      provider,
      apiKey: apiKey(env.OPENROUTER_API_KEY),
      baseUrl: secureBaseUrl(env.OPENROUTER_BASE_URL, OPENROUTER_TRANSCRIPTION_BASE_URL),
      model: env.OPENROUTER_TRANSCRIPTION_MODEL?.trim() || OPENROUTER_TRANSCRIPTION_MODEL,
    };
  }

  return {
    provider,
    apiKey: apiKey(env.OPENAI_API_KEY),
    baseUrl: OPENAI_TRANSCRIPTION_BASE_URL,
    model: OPENAI_TRANSCRIPTION_MODEL,
  };
}

export function getTranscriptionConfig(
  config: Pick<AppConfig, 'openaiApiKey'> & Partial<Pick<AppConfig, 'transcription'>>,
): TranscriptionConfig {
  return (
    config.transcription ?? {
      provider: 'openai',
      apiKey: config.openaiApiKey,
      baseUrl: OPENAI_TRANSCRIPTION_BASE_URL,
      model: OPENAI_TRANSCRIPTION_MODEL,
    }
  );
}
