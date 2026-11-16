import { describe, expect, it } from 'vitest';
import { getTranscriptionConfig, resolveTranscriptionConfig } from '../../src/voice/transcriptionProvider.js';

describe('transcription provider config', () => {
  it('keeps OpenAI and the existing model as the default', () => {
    expect(resolveTranscriptionConfig({})).toEqual({
      provider: 'openai',
      apiKey: null,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-transcribe',
    });
  });

  it('selects OpenRouter only when explicitly requested', () => {
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
    });
  });

  it('fails closed when the selected provider key is missing', () => {
    const config = resolveTranscriptionConfig({
      TRANSCRIPTION_PROVIDER: 'openrouter',
      OPENAI_API_KEY: 'openai-key-must-not-fallback',
    });
    expect(config.apiKey).toBeNull();
    expect(config.provider).toBe('openrouter');
  });

  it('rejects invalid providers and non-HTTPS OpenRouter endpoints', () => {
    expect(() => resolveTranscriptionConfig({ TRANSCRIPTION_PROVIDER: 'other' })).toThrow(
      'TRANSCRIPTION_PROVIDER must be openai or openrouter',
    );
    expect(() =>
      resolveTranscriptionConfig({
        TRANSCRIPTION_PROVIDER: 'openrouter',
        OPENROUTER_BASE_URL: 'http://openrouter.local/api/v1',
      }),
    ).toThrow('Transcription provider base URL must use HTTPS');
  });

  it('keeps the legacy config fallback on direct OpenAI', () => {
    expect(getTranscriptionConfig({ openaiApiKey: 'legacy-key' })).toEqual({
      provider: 'openai',
      apiKey: 'legacy-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-transcribe',
    });
  });
});
