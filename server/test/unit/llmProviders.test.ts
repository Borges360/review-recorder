import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWavFromPcm } from '../../src/voice/WavUtils.js';
import { getTranscriber, UnsupportedCapabilityError } from '../../src/voice/Transcriber.js';
import {
  buildTextHttpRequest,
  completeText,
  parseTextResponse,
  timelineToPrompt,
} from '../../src/llm/textTask.js';
import { PROVIDERS, isValidKeyRef, providerSupportsTask } from '../../src/llm/providers.js';
import type { ResolvedRoute } from '../../src/llm/types.js';

const SECRET = 'sk-test-SECRET-value-123';

function route(provider: ResolvedRoute['provider'], model: string, baseUrl: string): ResolvedRoute {
  return { task: 'session_summary', provider, model, baseUrl, keyRef: 'X_API_KEY', apiKey: SECRET, supported: true };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('capacidades por provedor', () => {
  it('Anthropic declara sem STT; OpenRouter só offline; OpenAI offline e realtime', () => {
    expect(getTranscriber('anthropic').capabilities).toEqual({ offline: false, realtime: false });
    expect(getTranscriber('openrouter').capabilities).toEqual({ offline: true, realtime: false });
    expect(getTranscriber('openai').capabilities).toEqual({ offline: true, realtime: true });
    expect(providerSupportsTask('anthropic', 'transcription_offline')).toBe(false);
    expect(providerSupportsTask('anthropic', 'session_summary')).toBe(true);
  });

  it('Anthropic e OpenRouter recusam o que não fazem, sem fingir suporte', () => {
    const r = route('anthropic', 'x', PROVIDERS.anthropic.defaultBaseUrl);
    expect(() => getTranscriber('anthropic').offline('a.wav', r)).toThrow(UnsupportedCapabilityError);
    expect(() => getTranscriber('anthropic').realtime(r, {} as never)).toThrow(UnsupportedCapabilityError);
    expect(() => getTranscriber('openrouter').realtime(r, {} as never)).toThrow(UnsupportedCapabilityError);
  });

  it('referência de chave: só a variável padrão do provedor ou nomes pré-declarados no ambiente', () => {
    expect(isValidKeyRef('openai', 'OPENAI_API_KEY', {})).toBe(true);
    // chave de outro provedor ou de outro serviço não pode ser apontada pelo admin
    expect(isValidKeyRef('openai', 'ANTHROPIC_API_KEY', {})).toBe(false);
    expect(isValidKeyRef('openai', 'STRIPE_API_KEY', {})).toBe(false);
    expect(isValidKeyRef('openai', 'DATABASE_URL', {})).toBe(false);
    expect(isValidKeyRef('openai', 'sk-live-abc_API_KEY', {})).toBe(false);
    // nomes extras só valem quando o operador os declara para aquele provedor
    const env = { LLM_KEY_REFS_OPENAI: 'TEAM_OPENAI_API_KEY, DATABASE_URL' };
    expect(isValidKeyRef('openai', 'TEAM_OPENAI_API_KEY', env)).toBe(true);
    expect(isValidKeyRef('openai', 'DATABASE_URL', env)).toBe(false);
    expect(isValidKeyRef('anthropic', 'TEAM_OPENAI_API_KEY', env)).toBe(false);
  });
});

describe('adapters de transcrição offline (HTTP falso)', () => {
  it('OpenAI e OpenRouter chamam /audio/transcriptions do próprio baseUrl com o modelo da rota', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rr-llm-'));
    try {
      const wavPath = join(dir, 'a.wav');
      writeFileSync(wavPath, buildWavFromPcm(Buffer.alloc(4800), 24000, 1, 16));
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: 'olá' }) });
      vi.stubGlobal('fetch', fetchMock);

      const oa = await getTranscriber('openai').offline(wavPath, {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini-transcribe',
        apiKey: SECRET,
      });
      expect(oa.text).toBe('olá');
      expect(oa.audioSeconds).toBeCloseTo(0.1, 3);

      await getTranscriber('openrouter').offline(wavPath, {
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'openai/gpt-4o-transcribe',
        apiKey: SECRET,
      });

      const [first, second] = fetchMock.mock.calls;
      expect(first![0]).toBe('https://api.openai.com/v1/audio/transcriptions');
      expect((first![1].body as FormData).get('model')).toBe('gpt-4o-mini-transcribe');
      expect(second![0]).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
      expect((second![1].body as FormData).get('model')).toBe('openai/gpt-4o-transcribe');
      expect(second![1].headers).toEqual({ Authorization: `Bearer ${SECRET}` });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('chunk WebM: só OpenAI pede timestamp_granularities', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: 'oi', segments: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await getTranscriber('openai').offlineChunk(Buffer.from('x'), 1000, {
      provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-transcribe', apiKey: SECRET,
    });
    await getTranscriber('openrouter').offlineChunk(Buffer.from('x'), 1000, {
      provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-transcribe', apiKey: SECRET,
    });
    expect((fetchMock.mock.calls[0]![1].body as FormData).get('timestamp_granularities[]')).toBe('segment');
    expect((fetchMock.mock.calls[1]![1].body as FormData).get('timestamp_granularities[]')).toBeNull();
  });

  it('falha de HTTP devolve erro sem vazar a chave', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid api key' }));
    const result = await getTranscriber('openai').offlineChunk(Buffer.from('x'), 1000, {
      provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'm', apiKey: SECRET,
    });
    expect(result.error).toContain('HTTP 401');
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe('tarefa de texto (resumo): payload e parsing por provedor', () => {
  const req = { system: 'sys', user: 'usr', maxTokens: 500 };

  it('Anthropic usa /messages com x-api-key e anthropic-version', () => {
    const http = buildTextHttpRequest(route('anthropic', 'claude-haiku-5-5', 'https://api.anthropic.com/v1'), SECRET, req);
    expect(http.url).toBe('https://api.anthropic.com/v1/messages');
    expect(http.headers['x-api-key']).toBe(SECRET);
    expect(http.headers['anthropic-version']).toBe('2023-06-01');
    expect(http.headers.Authorization).toBeUndefined();
    expect(http.body).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 500,
      system: 'sys',
      messages: [{ role: 'user', content: 'usr' }],
    });
  });

  it('OpenAI e OpenRouter usam /chat/completions com Bearer', () => {
    for (const [provider, base] of [
      ['openai', 'https://api.openai.com/v1'],
      ['openrouter', 'https://openrouter.ai/api/v1/'],
    ] as const) {
      const http = buildTextHttpRequest(route(provider, 'm', base), SECRET, req);
      expect(http.url).toBe(`${base.replace(/\/$/, '')}/chat/completions`);
      expect(http.headers.Authorization).toBe(`Bearer ${SECRET}`);
      expect(http.body).toMatchObject({
        model: 'm',
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'usr' },
        ],
      });
    }
  });

  it('esforço de raciocínio: parâmetro certo por provedor, e nada é enviado sem esforço', () => {
    const anthropic = buildTextHttpRequest(route('anthropic', 'claude-haiku-5-5', 'https://api.anthropic.com/v1'), SECRET, { ...req, effort: 'high' });
    expect(anthropic.body).toMatchObject({ output_config: { effort: 'high' }, max_tokens: 500 + 8192 });
    expect(anthropic.body).not.toHaveProperty('reasoning_effort');
    const openai = buildTextHttpRequest(route('openai', 'o4-mini', 'https://api.openai.com/v1'), SECRET, { ...req, effort: 'low' });
    expect(openai.body).toMatchObject({ reasoning_effort: 'low', max_completion_tokens: 500 + 1024 });
    expect(openai.body).not.toHaveProperty('reasoning');
    const openrouter = buildTextHttpRequest(route('openrouter', 'openai/o4-mini', 'https://openrouter.ai/api/v1'), SECRET, { ...req, effort: 'medium' });
    expect(openrouter.body).toMatchObject({ reasoning: { effort: 'medium' }, max_completion_tokens: 500 + 4096 });
    expect(openrouter.body).not.toHaveProperty('reasoning_effort');
    for (const provider of ['anthropic', 'openai', 'openrouter'] as const) {
      const body = buildTextHttpRequest(route(provider, 'm', 'https://x.test/v1'), SECRET, req).body;
      expect(body).not.toHaveProperty('reasoning');
      expect(body).not.toHaveProperty('reasoning_effort');
      expect(body).not.toHaveProperty('output_config');
    }
  });

  it('extrai texto e tokens de cada formato de resposta', () => {
    expect(
      parseTextResponse('anthropic', {
        content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'resumo' }],
        usage: { input_tokens: 120, output_tokens: 30 },
      }),
    ).toEqual({ text: 'resumo', inputTokens: 120, outputTokens: 30 });
    expect(
      parseTextResponse('openai', {
        choices: [{ message: { content: 'resumo' } }],
        usage: { prompt_tokens: 80, completion_tokens: 20 },
      }),
    ).toEqual({ text: 'resumo', inputTokens: 80, outputTokens: 20 });
    expect(parseTextResponse('openai', { choices: [{ message: { content: '' }, finish_reason: 'length' }] })).toMatchObject({ text: '', stopReason: 'length' });
    expect(parseTextResponse('anthropic', { content: [{ type: 'thinking' }], stop_reason: 'max_tokens' })).toMatchObject({ text: '', stopReason: 'max_tokens' });
  });

  it('completeText propaga erro HTTP sem a chave e exige chave', async () => {
    const failing = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'slow down' });
    await expect(
      completeText(route('anthropic', 'm', 'https://api.anthropic.com/v1'), req, failing as never),
    ).rejects.toThrow('HTTP 429');
    await expect(
      completeText({ ...route('openai', 'm', 'https://x'), apiKey: null }, req, failing as never),
    ).rejects.toThrow('no_api_key');
    try {
      await completeText(route('anthropic', 'm', 'https://api.anthropic.com/v1'), req, failing as never);
    } catch (e) {
      expect(String(e)).not.toContain(SECRET);
    }
  });

  it('timelineToPrompt resume a timeline e limita o tamanho avisando', () => {
    const text = timelineToPrompt([
      { type: 'screen', offset: '00:01', screen: { title: 'Home' } },
      { type: 'observation', offset: '00:05', speech: { text: 'botão torto' } },
    ]);
    expect(text).toContain('[00:05] FALA: botão torto');
    expect(timelineToPrompt([{ type: 'action', offset: '0', action: 'x'.repeat(100) }], 20)).toContain('[timeline truncada]');
  });
});
