import type { AppConfig, TranscriptionConfig, TranscriptionProviderName } from '../shared/types.js';

export const OPENAI_TRANSCRIPTION_BASE_URL = 'https://api.openai.com/v1';
export const OPENAI_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';
export const OPENROUTER_TRANSCRIPTION_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_TRANSCRIPTION_MODEL = 'openai/gpt-4o-transcribe';

/** Prefix of every transcription configuration error, so logs and events can be matched by name. */
export const TRANSCRIPTION_CONFIG_ERROR = 'transcription_config_error';

const PROVIDERS: readonly TranscriptionProviderName[] = ['openai', 'openrouter'];

const REQUIRED_KEY: Record<TranscriptionProviderName, string> = {
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

function configError(message: string): string {
  return `${TRANSCRIPTION_CONFIG_ERROR}: ${message}`;
}

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

function unavailable(
  error: string,
  provider: TranscriptionProviderName | null = null,
): TranscriptionConfig {
  return { provider, apiKey: null, baseUrl: '', model: '', error };
}

/**
 * Resolves the HTTP transcription provider from the environment.
 *
 * `TRANSCRIPTION_PROVIDER` is mandatory and has no default. A missing or invalid selector, a missing key
 * for the selected provider or a non-HTTPS endpoint never throws: the server keeps booting and the
 * returned config carries a named `error`, so every transcription call fails explicitly. The key of one
 * provider is never used for the other. Realtime (live audio) is not covered here: it always uses
 * `OPENAI_API_KEY`.
 */
export function resolveTranscriptionConfig(env: NodeJS.ProcessEnv): TranscriptionConfig {
  const raw = env.TRANSCRIPTION_PROVIDER?.trim().toLowerCase();
  if (!raw) {
    return unavailable(configError('TRANSCRIPTION_PROVIDER is required (openai or openrouter)'));
  }
  if (!PROVIDERS.includes(raw as TranscriptionProviderName)) {
    return unavailable(configError('TRANSCRIPTION_PROVIDER must be openai or openrouter'));
  }
  const provider = raw as TranscriptionProviderName;

  let baseUrl: string;
  let model: string;
  let key: string | null;
  try {
    if (provider === 'openrouter') {
      key = apiKey(env.OPENROUTER_API_KEY);
      baseUrl = secureBaseUrl(
        env.OPENROUTER_TRANSCRIPTION_BASE_URL?.trim() || env.OPENROUTER_BASE_URL,
        OPENROUTER_TRANSCRIPTION_BASE_URL,
      );
      model = env.OPENROUTER_TRANSCRIPTION_MODEL?.trim() || OPENROUTER_TRANSCRIPTION_MODEL;
    } else {
      key = apiKey(env.OPENAI_API_KEY);
      baseUrl = OPENAI_TRANSCRIPTION_BASE_URL;
      model = OPENAI_TRANSCRIPTION_MODEL;
    }
  } catch (err) {
    return unavailable(configError(err instanceof Error ? err.message : String(err)), provider);
  }

  if (!key) {
    return {
      provider,
      apiKey: null,
      baseUrl,
      model,
      error: configError(
        `${REQUIRED_KEY[provider]} is required when TRANSCRIPTION_PROVIDER=${provider}`,
      ),
    };
  }
  return { provider, apiKey: key, baseUrl, model, error: null };
}

export function getTranscriptionConfig(
  config: Partial<Pick<AppConfig, 'transcription'>>,
): TranscriptionConfig {
  return (
    config.transcription ??
    unavailable(configError('TRANSCRIPTION_PROVIDER is required (openai or openrouter)'))
  );
}

export type UsableTranscription = TranscriptionConfig & {
  provider: TranscriptionProviderName;
  apiKey: string;
  error: null;
};

export function isTranscriptionUsable(config: TranscriptionConfig): config is UsableTranscription {
  return config.error === null && config.provider !== null && Boolean(config.apiKey);
}
