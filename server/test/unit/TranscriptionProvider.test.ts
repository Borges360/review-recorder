import { describe, expect, it } from 'vitest';
import {
  getTranscriptionConfig,
  isTranscriptionUsable,
  resolveTranscriptionConfig,
} from '../../src/voice/transcriptionProvider.js';

describe('transcription provider config', () => {
  it('has no default provider: a missing selector makes transcription unavailable with a named error', () => {
    const config = resolveTranscriptionConfig({ OPENAI_API_KEY: 'openai-key-must-not-be-implied' });
    expect(config.provider).toBeNull();
    expect(config.apiKey).toBeNull();
    expect(config.error).toBe(
      'transcription_config_error: TRANSCRIPTION_PROVIDER is required (openai or openrouter)',
    );
    expect(isTranscriptionUsable(config)).toBe(false);
  });

  it('treats a blank selector as missing', () => {
    expect(resolveTranscriptionConfig({ TRANSCRIPTION_PROVIDER: '  ' }).error).toContain(
      'TRANSCRIPTION_PROVIDER is required',
    );
  });

  it('rejects invalid providers without throwing, so the server still boots', () => {
    const config = resolveTranscriptionConfig({
      TRANSCRIPTION_PROVIDER: 'other',
      OPENAI_API_KEY: 'k',
    });
    expect(config.provider).toBeNull();
    expect(config.apiKey).toBeNull();
    expect(config.error).toBe(
      'transcription_config_error: TRANSCRIPTION_PROVIDER must be openai or openrouter',
    );
  });

  it('keeps the current OpenAI endpoint and model when openai is explicit', () => {
    expect(
      resolveTranscriptionConfig({
        TRANSCRIPTION_PROVIDER: ' OpenAI ',
        OPENAI_API_KEY: ' openai-key ',
      }),
    ).toEqual({
      provider: 'openai',
      apiKey: 'openai-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-transcribe',
      error: null,
    });
  });

  it('openai never borrows the OpenRouter key', () => {
    const config = resolveTranscriptionConfig({
      TRANSCRIPTION_PROVIDER: 'openai',
      OPENROUTER_API_KEY: 'router-key',
    });
    expect(config.apiKey).toBeNull();
    expect(config.error).toBe(
      'transcription_config_error: OPENAI_API_KEY is required when TRANSCRIPTION_PROVIDER=openai',
    );
  });

  it('selects OpenRouter with its own key and the current model', () => {
    expect(
      resolveTranscriptionConfig({
        TRANSCRIPTION_PROVIDER: 'openrouter',
        OPENAI_API_KEY: 'openai-key-must-not-fallback',
        OPENROUTER_API_KEY: ' router-key ',
        OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1/',
      }),
    ).toEqual({
      provider: 'openrouter',
      apiKey: 'router-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-4o-transcribe',
      error: null,
    });
  });

  it('prefers OPENROUTER_TRANSCRIPTION_BASE_URL over OPENROUTER_BASE_URL', () => {
    const config = resolveTranscriptionConfig({
      TRANSCRIPTION_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'router-key',
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
      OPENROUTER_TRANSCRIPTION_BASE_URL: 'https://stt.openrouter.example/api/v1',
    });
    expect(config.baseUrl).toBe('https://stt.openrouter.example/api/v1');
  });

  it('openrouter without its key is unavailable and never falls back to the OpenAI key', () => {
    const config = resolveTranscriptionConfig({
      TRANSCRIPTION_PROVIDER: 'openrouter',
      OPENAI_API_KEY: 'openai-key-must-not-fallback',
    });
    expect(config.provider).toBe('openrouter');
    expect(config.apiKey).toBeNull();
    expect(config.error).toBe(
      'transcription_config_error: OPENROUTER_API_KEY is required when TRANSCRIPTION_PROVIDER=openrouter',
    );
    expect(isTranscriptionUsable(config)).toBe(false);
  });

  it('rejects non-HTTPS OpenRouter endpoints as a configuration error', () => {
    const config = resolveTranscriptionConfig({
      TRANSCRIPTION_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'router-key',
      OPENROUTER_BASE_URL: 'http://openrouter.local/api/v1',
    });
    expect(config.apiKey).toBeNull();
    expect(config.error).toBe(
      'transcription_config_error: Transcription provider base URL must use HTTPS',
    );
  });

  it('has no legacy OpenAI fallback when the app config lacks a transcription block', () => {
    const config = getTranscriptionConfig({});
    expect(config.provider).toBeNull();
    expect(config.error).toContain('TRANSCRIPTION_PROVIDER is required');
  });
});
