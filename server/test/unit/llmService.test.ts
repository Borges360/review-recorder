import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LlmService,
  LlmTaskError,
  LlmValidationError,
  monthBounds,
} from '../../src/llm/LlmService.js';
import { FileLlmPersistence, MemoryLlmPersistence } from '../../src/llm/persistence.js';
import { estimateCostUsd, findTariff } from '../../src/llm/pricing.js';

const KEYS = {
  OPENAI_API_KEY: 'sk-openai-SECRET-1',
  OPENROUTER_API_KEY: 'sk-or-SECRET-2',
  ANTHROPIC_API_KEY: 'sk-ant-SECRET-3',
};

function svc(env: NodeJS.ProcessEnv = {}, extra: Parameters<typeof LlmService.create>[0] = {}) {
  return LlmService.create({ env, persistence: new MemoryLlmPersistence(), ...extra });
}

describe('resolução de rota e retrocompatibilidade', () => {
  it('sem configuração nova mantém os defaults de hoje', async () => {
    const llm = await svc({ OPENAI_API_KEY: KEYS.OPENAI_API_KEY });
    expect(llm.resolve('transcription_realtime')).toMatchObject({
      provider: 'openai',
      model: 'gpt-live-transcribe',
      apiKey: KEYS.OPENAI_API_KEY,
      supported: true,
    });
    expect(llm.resolve('transcription_offline')).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-transcribe',
      baseUrl: 'https://api.openai.com/v1',
    });
    expect(llm.summaryEnabled()).toBe(false);
  });

  it('respeita TRANSCRIPTION_PROVIDER=openrouter e seu modelo do ambiente', async () => {
    const llm = await svc({
      TRANSCRIPTION_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: KEYS.OPENROUTER_API_KEY,
      OPENROUTER_TRANSCRIPTION_MODEL: 'openai/gpt-4o-mini-transcribe',
    });
    expect(llm.resolve('transcription_offline')).toMatchObject({
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini-transcribe',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: KEYS.OPENROUTER_API_KEY,
    });
    // Realtime continues on OpenAI regardless of the offline provider.
    expect(llm.resolve('transcription_realtime').provider).toBe('openai');
  });

  it('override do admin troca provedor e modelo por tarefa; trocar provedor limpa o modelo antigo', async () => {
    const llm = await svc(KEYS);
    await llm.update({ routes: { transcription_offline: { provider: 'openrouter', model: 'openai/whisper-1' } } });
    expect(llm.resolve('transcription_offline')).toMatchObject({ provider: 'openrouter', model: 'openai/whisper-1' });
    await llm.update({ routes: { transcription_offline: { provider: 'openai' } } });
    expect(llm.resolve('transcription_offline')).toMatchObject({ provider: 'openai', model: 'gpt-4o-transcribe' });
    await llm.update({ routes: { transcription_offline: null } });
    expect(llm.getSettings().routes).toEqual({});
  });

  it('Anthropic é recusada para transcrição e OpenRouter para realtime', async () => {
    const llm = await svc(KEYS);
    await expect(llm.update({ routes: { transcription_offline: { provider: 'anthropic' } } })).rejects.toThrow(/sem STT/);
    await expect(llm.update({ routes: { transcription_realtime: { provider: 'anthropic' } } })).rejects.toThrow(LlmValidationError);
    await expect(llm.update({ routes: { transcription_realtime: { provider: 'openrouter' } } })).rejects.toThrow(LlmValidationError);
    expect(llm.getSettings().routes).toEqual({});
  });

  it('a chave vem do ambiente pela referência escolhida; sem a variável a rota fica sem chave', async () => {
    const llm = await svc({ ...KEYS, TEAM_OPENAI_API_KEY: 'sk-team-SECRET-4', LLM_KEY_REFS_OPENAI: 'TEAM_OPENAI_API_KEY,MISSING_API_KEY' });
    await llm.update({ keyRefs: { openai: 'TEAM_OPENAI_API_KEY' } });
    expect(llm.resolve('transcription_offline').apiKey).toBe('sk-team-SECRET-4');
    await llm.update({ keyRefs: { openai: 'MISSING_API_KEY' } });
    expect(llm.resolve('transcription_offline').apiKey).toBeNull();
    expect(llm.keyConfigured('openai')).toBe(false);
    await llm.update({ keyRefs: { openai: null } });
    expect(llm.keyRef('openai')).toBe('OPENAI_API_KEY');
  });

  it('rejeita referência de chave que não seja *_API_KEY, modelo inválido e valores perigosos', async () => {
    const llm = await svc(KEYS);
    await expect(llm.update({ keyRefs: { openai: 'DATABASE_URL' } })).rejects.toThrow(LlmValidationError);
    await expect(llm.update({ keyRefs: { openai: 'sk-live-123' } })).rejects.toThrow(LlmValidationError);
    // chave de outro provedor/serviço presente no ambiente não pode ser redirecionada para o host do provedor
    await expect(llm.update({ keyRefs: { openai: 'ANTHROPIC_API_KEY' } })).rejects.toThrow(/keyRef não permitido/);
    await expect(llm.update({ keyRefs: { anthropic: 'OPENROUTER_API_KEY' } })).rejects.toThrow(LlmValidationError);
    expect(llm.getSettings().keyRefs).toEqual({});
    await expect(llm.update({ routes: { session_summary: { model: 'a b; rm -rf' } } })).rejects.toThrow('invalid model');
    await expect(llm.update({ routes: { nope: { model: 'x' } } as never })).rejects.toThrow('unknown task');
    await expect(llm.update({ budget: { monthlyUsd: -1 } })).rejects.toThrow(LlmValidationError);
    await expect(llm.update({ tariffs: { 'bad key': { audioUsdPerMinute: 1 } } })).rejects.toThrow(LlmValidationError);
    await expect(llm.update({ tariffs: { 'openai/x': { audioUsdPerMinute: -2 } } })).rejects.toThrow(LlmValidationError);
  });
});

describe('ausência de vazamento de chave', () => {
  it('view, settings, auditoria e respostas de teste nunca contêm o valor da chave', async () => {
    const persistence = new MemoryLlmPersistence();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const llm = await LlmService.create({ env: KEYS, persistence, fetchImpl: fetchImpl as never });
    await llm.update({ keyRefs: { anthropic: 'ANTHROPIC_API_KEY' }, summaryEnabled: true });
    const test = await llm.testConnection('anthropic');
    const dump = JSON.stringify([
      await llm.view(),
      llm.getSettings(),
      await llm.audit(),
      test,
      await persistence.loadSettings(),
    ]);
    for (const secret of Object.values(KEYS)) expect(dump).not.toContain(secret);
    const view = await llm.view();
    expect(view.providers.find((p) => p.id === 'anthropic')).toMatchObject({ keyConfigured: true, keyRef: 'ANTHROPIC_API_KEY' });
  });
});

describe('teste de conexão', () => {
  it('chama o endpoint certo de cada provedor com o cabeçalho certo', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const llm = await svc(KEYS, { fetchImpl: fetchImpl as never });
    expect((await llm.testConnection('openai')).ok).toBe(true);
    await llm.testConnection('openrouter');
    await llm.testConnection('anthropic');
    const [oa, or, an] = fetchImpl.mock.calls;
    expect(oa![0]).toBe('https://api.openai.com/v1/models');
    expect(oa![1].headers).toEqual({ Authorization: `Bearer ${KEYS.OPENAI_API_KEY}` });
    expect(or![0]).toBe('https://openrouter.ai/api/v1/key');
    expect(an![0]).toBe('https://api.anthropic.com/v1/models?limit=1');
    expect(an![1].headers).toEqual({ 'x-api-key': KEYS.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' });
  });

  it('sem variável configurada não faz rede; erro de rede e 401 viram mensagens sem segredo', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error(`boom ${KEYS.OPENAI_API_KEY}`));
    const llm = await svc({ OPENAI_API_KEY: KEYS.OPENAI_API_KEY }, { fetchImpl: fetchImpl as never });
    const missing = await llm.testConnection('anthropic');
    expect(missing).toMatchObject({ ok: false, status: null });
    expect(fetchImpl).not.toHaveBeenCalled();
    const failed = await llm.testConnection('openai');
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).not.toContain(KEYS.OPENAI_API_KEY);
  });
});

describe('custo, tarifa versionada e orçamento', () => {
  const now = new Date('2026-11-15T12:00:00Z');

  it('calcula custo de áudio por minuto e de texto por tokens; sem tarifa fica null', () => {
    expect(estimateCostUsd(findTariff({}, 'openai', 'gpt-4o-transcribe'), { audioSeconds: 600, inputTokens: 0, outputTokens: 0 })).toBeCloseTo(0.06, 6);
    expect(
      estimateCostUsd(findTariff({}, 'anthropic', 'claude-haiku-5-5'), { audioSeconds: 0, inputTokens: 1_000_000, outputTokens: 200_000 }),
    ).toBeCloseTo(0.2, 6);
    expect(estimateCostUsd(findTariff({}, 'openai', 'modelo-desconhecido'), { audioSeconds: 60, inputTokens: 0, outputTokens: 0 })).toBeNull();
  });

  it('tarifa editada no painel muda o custo e incrementa a versão registrada', async () => {
    const llm = await svc(KEYS, { now: () => now });
    const before = await llm.recordUsage({ sessionId: 's1', task: 'transcription_offline', provider: 'openai', model: 'gpt-4o-transcribe', audioSeconds: 60 });
    await llm.update({ tariffs: { 'openai/gpt-4o-transcribe': { audioUsdPerMinute: 0.02 } } });
    const after = await llm.recordUsage({ sessionId: 's1', task: 'transcription_offline', provider: 'openai', model: 'gpt-4o-transcribe', audioSeconds: 60 });
    expect(before.costUsd).toBeCloseTo(0.006, 6);
    expect(after.costUsd).toBeCloseTo(0.02, 6);
    expect(before.tariffVersion).toBe('builtin-2026-11');
    expect(after.tariffVersion).toBe('builtin-2026-11+custom#1');
  });

  it('relatório mensal agrega por tarefa, modelo e sessão e separa chamadas sem tarifa', async () => {
    const llm = await svc(KEYS, { now: () => now });
    await llm.recordUsage({ sessionId: 'a', task: 'transcription_offline', provider: 'openai', model: 'gpt-4o-transcribe', audioSeconds: 120 });
    await llm.recordUsage({ sessionId: 'a', task: 'transcription_realtime', provider: 'openai', model: 'gpt-live-transcribe', audioSeconds: 60 });
    await llm.recordUsage({ sessionId: 'b', task: 'session_summary', provider: 'anthropic', model: 'claude-haiku-5-5', inputTokens: 1000, outputTokens: 500 });
    await llm.recordUsage({ sessionId: 'b', task: 'session_summary', provider: 'openai', model: 'sem-tarifa', inputTokens: 10, outputTokens: 10 });
    const report = await llm.usageReport('2026-11');
    expect(report.totals.calls).toBe(4);
    expect(report.totals.unpricedCalls).toBe(1);
    expect(report.byTask.transcription_offline!.audioSeconds).toBe(120);
    expect(report.sessions[0]!.sessionId).toBe('a');
    expect(report.sessions[0]!.costUsd).toBeCloseTo(0.018, 6);
    expect((await llm.usageReport('2026-10')).totals.calls).toBe(0);
    const one = await llm.sessionUsage('a');
    expect(one.calls).toBe(2);
    expect(monthBounds('2026-12').end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(() => monthBounds('2026-13')).toThrow(LlmValidationError);
  });

  it('orçamento mensal: warn só avisa, block impede novos gastos', async () => {
    const llm = await svc(KEYS, { now: () => now });
    await llm.update({ budget: { monthlyUsd: 0.01, action: 'warn' } });
    await llm.recordUsage({ sessionId: 'a', task: 'transcription_offline', provider: 'openai', model: 'gpt-4o-transcribe', audioSeconds: 120 });
    let spend = await llm.allowSpend();
    expect(spend.status.exceeded).toBe(true);
    expect(spend.allowed).toBe(true);
    await llm.update({ budget: { action: 'block' } });
    spend = await llm.allowSpend();
    expect(spend.allowed).toBe(false);
    await llm.update({ budget: { monthlyUsd: null } });
    expect((await llm.allowSpend()).allowed).toBe(true);
  });
});

describe('orçamento: modelo sem tarifa, falha do banco e cache', () => {
  const now = new Date('2026-11-15T12:00:00Z');

  it('em modo block, rota sem tarifa é recusada (custo desconhecido não pode furar o teto)', async () => {
    const llm = await svc(KEYS, { now: () => now });
    await llm.update({ budget: { monthlyUsd: 5, action: 'block' }, routes: { session_summary: { provider: 'openrouter', model: 'google/gemini-x' } } });
    const route = llm.resolve('session_summary');
    expect(llm.hasTariff(route)).toBe(false);
    expect(await llm.allowSpend(route)).toMatchObject({ allowed: false, reason: 'unpriced_model' });
    // com tarifa cadastrada passa a valer o teto normal
    await llm.update({ tariffs: { 'openrouter/google/gemini-x': { inputUsdPerMTok: 1, outputUsdPerMTok: 2 } } });
    expect(await llm.allowSpend(route)).toMatchObject({ allowed: true });
    // modo warn ou sem teto não bloqueia por falta de tarifa
    await llm.update({ tariffs: { 'openrouter/google/gemini-x': null }, budget: { action: 'warn' } });
    expect((await llm.allowSpend(route)).allowed).toBe(true);
    await llm.update({ budget: { monthlyUsd: null, action: 'block' } });
    expect((await llm.allowSpend(route)).allowed).toBe(true);
    // painel mostra quais tarefas estão sem tarifa
    const view = await llm.view();
    expect(view.tasks.find((t) => t.id === 'session_summary')).toMatchObject({ priced: false });
    expect(view.tasks.find((t) => t.id === 'transcription_offline')).toMatchObject({ priced: true });
  });

  it('resumo com modelo sem tarifa e teto em block falha com unpriced_model sem chamar a rede', async () => {
    const fetchImpl = vi.fn();
    const llm = await svc(KEYS, { now: () => now, fetchImpl: fetchImpl as never });
    await llm.update({ summaryEnabled: true, budget: { monthlyUsd: 5, action: 'block' }, routes: { session_summary: { provider: 'anthropic', model: 'claude-futuro-9' } } });
    await expect(llm.summarizeTimeline('s', [])).rejects.toMatchObject({ code: 'unpriced_model' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falha ao ler o uso não derruba o caminho da gravação: libera com aviso', async () => {
    const persistence = new MemoryLlmPersistence();
    vi.spyOn(persistence, 'listUsage').mockRejectedValue(new Error('db down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const llm = await svc(KEYS, { persistence, now: () => now });
    await llm.update({ budget: { monthlyUsd: 1, action: 'block' } });
    await expect(llm.allowSpend(llm.resolve('transcription_offline'))).resolves.toMatchObject({ allowed: true, degraded: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('o gasto do mês é lido uma vez e atualizado por incremento (sem varrer o mês a cada chamada)', async () => {
    const persistence = new MemoryLlmPersistence();
    const listUsage = vi.spyOn(persistence, 'listUsage');
    const llm = await svc(KEYS, { persistence, now: () => now });
    await llm.update({ budget: { monthlyUsd: 0.05, action: 'block' } });
    const route = llm.resolve('transcription_offline');
    for (let i = 0; i < 5; i += 1) await llm.allowSpend(route);
    expect(listUsage).toHaveBeenCalledTimes(1);
    await llm.recordUsage({ sessionId: 's', task: 'transcription_offline', provider: 'openai', model: 'gpt-4o-transcribe', audioSeconds: 600 });
    expect(listUsage).toHaveBeenCalledTimes(1);
    expect(await llm.allowSpend(route)).toMatchObject({ allowed: false, reason: 'budget_exceeded' });
  });
});

describe('persistência e auditoria', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rr-llm-store-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('arquivo em DATA_DIR sobrevive a reinício e guarda só o NOME da variável de chave', async () => {
    const first = await LlmService.create({ env: KEYS, persistence: new FileLlmPersistence(dir) });
    await first.update({
      routes: { transcription_offline: { provider: 'openrouter', model: 'openai/gpt-4o-transcribe' } },
      keyRefs: { openrouter: 'OPENROUTER_API_KEY' },
      summaryEnabled: true,
    });
    await first.recordUsage({ sessionId: 'x', task: 'transcription_offline', provider: 'openrouter', model: 'openai/gpt-4o-transcribe', audioSeconds: 30 });

    const second = await LlmService.create({ env: KEYS, persistence: new FileLlmPersistence(dir) });
    expect(second.resolve('transcription_offline').provider).toBe('openrouter');
    expect(second.summaryEnabled()).toBe(true);
    expect((await second.sessionUsage('x')).calls).toBe(1);
    const audit = await second.audit();
    expect(audit[0]).toMatchObject({ action: 'settings.update' });
    expect(audit[0]!.changes).toEqual(expect.arrayContaining(['routes.transcription_offline', 'keyRefs.openrouter', 'summaryEnabled']));

    const raw = ['llm-settings.json', 'llm-usage.jsonl', 'llm-audit.jsonl'].map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    for (const secret of Object.values(KEYS)) expect(raw).not.toContain(secret);
    expect(raw).toContain('OPENROUTER_API_KEY');
  });
});

describe('resumo opcional da timeline', () => {
  const timeline = [{ type: 'observation', offset: '00:03', speech: { text: 'o modal está grande' } }];

  it('vem desabilitado por padrão e não chama a rede', async () => {
    const fetchImpl = vi.fn();
    const llm = await svc(KEYS, { fetchImpl: fetchImpl as never });
    await expect(llm.summarizeTimeline('s', timeline)).rejects.toMatchObject({ code: 'summary_disabled' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('com Anthropic habilitada envia a timeline, registra tokens e custo', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'Resumo: modal grande.' }], usage: { input_tokens: 2000, output_tokens: 400 } }),
    });
    const llm = await svc(KEYS, { fetchImpl: fetchImpl as never });
    await llm.update({ summaryEnabled: true, routes: { session_summary: { provider: 'anthropic' } } });
    const result = await llm.summarizeTimeline('s1', timeline);
    expect(result).toMatchObject({ summary: 'Resumo: modal grande.', provider: 'anthropic', model: 'claude-haiku-5-5' });
    expect(result.costUsd).toBeCloseTo((2000 * 0.1 + 400 * 0.5) / 1_000_000, 8);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(JSON.parse(init.body).messages[0].content).toContain('o modal está grande');
    expect((await llm.sessionUsage('s1')).inputTokens).toBe(2000);
  });

  it('erros: sem chave, orçamento bloqueado e falha do provedor', async () => {
    const llm = await svc({}, { fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'oops' }) as never });
    await llm.update({ summaryEnabled: true });
    await expect(llm.summarizeTimeline('s', timeline)).rejects.toMatchObject({ code: 'no_api_key' });

    const keyed = await svc(KEYS, { fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'oops' }) as never });
    await keyed.update({ summaryEnabled: true });
    await expect(keyed.summarizeTimeline('s', timeline)).rejects.toBeInstanceOf(LlmTaskError);
    await expect(keyed.summarizeTimeline('s', timeline)).rejects.toMatchObject({ code: 'upstream_error' });

    await keyed.update({ budget: { monthlyUsd: 0, action: 'block' } });
    await expect(keyed.summarizeTimeline('s', timeline)).rejects.toMatchObject({ code: 'budget_exceeded' });
  });

  it('resposta vazia (raciocínio consumiu os tokens) vira upstream_error, é cobrada e não devolve resumo', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 300, completion_tokens: 1500 } }),
    });
    const llm = await svc(KEYS, { fetchImpl: fetchImpl as never });
    await llm.update({ summaryEnabled: true });
    const error = await llm.summarizeTimeline('s9', timeline).catch((e) => e);
    expect(error).toBeInstanceOf(LlmTaskError);
    expect(error).toMatchObject({ code: 'upstream_error' });
    expect(error.message).toMatch(/vazio \(length\)/);
    const usage = await llm.sessionUsage('s9');
    expect(usage.calls).toBe(1);
    expect(usage.outputTokens).toBe(1500);
    expect(usage.records[0]!.ok).toBe(false);
  });

  it('esforço escolhido no painel vai no corpo certo de cada provedor; só vale para o resumo', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    });
    const llm = await svc(KEYS, { fetchImpl: fetchImpl as never });
    await llm.update({ summaryEnabled: true, routes: { session_summary: { provider: 'openrouter', model: 'openai/o4-mini', effort: 'high' } } });
    await llm.summarizeTimeline('s', timeline);
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body)).toMatchObject({ reasoning: { effort: 'high' } });
    expect((await llm.view()).tasks.find((t) => t.id === 'session_summary')).toMatchObject({ effort: 'high' });
    await expect(llm.update({ routes: { session_summary: { effort: 'turbo' as never } } })).rejects.toThrow(LlmValidationError);
    await expect(llm.update({ routes: { transcription_offline: { effort: 'low' } } })).rejects.toThrow(/effort/);
    await llm.update({ routes: { session_summary: { effort: null } } });
    expect(llm.resolve('session_summary').effort).toBeUndefined();
  });
});
