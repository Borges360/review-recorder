import { buildApp } from '../../src/index.js';
import { checkAdminAccess } from '../../src/app/adminRoutes.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'rr-admin-llm-'));
const ENV_KEYS = [
  'SESSIONS_DIR', 'DATA_DIR', 'BROWSER_PROFILE_DIR', 'USE_FAKE_TRANSCRIBER', 'API_TOKEN', 'ADMIN_TOKEN', 'HOST',
  'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'TRANSCRIPTION_PROVIDER', 'DATABASE_URL',
];
const saved: Record<string, string | undefined> = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

const OPENAI = 'sk-openai-TOPSECRET-aaa';
const OPENROUTER = 'sk-or-TOPSECRET-bbb';
const ANTHROPIC = 'sk-ant-TOPSECRET-ccc';
let counter = 0;

beforeEach(() => {
  counter += 1;
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.SESSIONS_DIR = join(root, `sessions-${counter}`);
  process.env.DATA_DIR = join(root, `data-${counter}`);
  process.env.BROWSER_PROFILE_DIR = join(root, `profile-${counter}`);
  process.env.TRANSCRIPTION_PROVIDER = 'openai';
  process.env.OPENAI_API_KEY = OPENAI;
  process.env.OPENROUTER_API_KEY = OPENROUTER;
  process.env.ANTHROPIC_API_KEY = ANTHROPIC;
});

afterEach(() => vi.unstubAllGlobals());

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(root, { recursive: true, force: true });
});

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('permissão de admin', () => {
  it('checkAdminAccess: ADMIN_TOKEN exclusivo, depois API_TOKEN, depois só loopback', () => {
    expect(checkAdminAccess({ adminToken: 'a', apiToken: 'b', host: '0.0.0.0' }, 'Bearer b')).toMatchObject({ ok: false, status: 401 });
    expect(checkAdminAccess({ adminToken: 'a', apiToken: 'b', host: '0.0.0.0' }, 'Bearer a')).toEqual({ ok: true });
    expect(checkAdminAccess({ adminToken: null, apiToken: 'b', host: '0.0.0.0' }, 'Bearer b')).toEqual({ ok: true });
    expect(checkAdminAccess({ adminToken: null, apiToken: null, host: '0.0.0.0' }, undefined)).toMatchObject({ ok: false, status: 403 });
    expect(checkAdminAccess({ adminToken: null, apiToken: null, host: '127.0.0.1' }, undefined)).toEqual({ ok: true });
  });

  it('checkAdminAccess: API_TOKEN só lê; alterar exige ADMIN_TOKEN; loopback exige origem direta', () => {
    const apiOnly = { adminToken: null, apiToken: 'b', host: '127.0.0.1' };
    expect(checkAdminAccess(apiOnly, 'Bearer b', { mutation: false })).toEqual({ ok: true });
    expect(checkAdminAccess(apiOnly, 'Bearer b', { mutation: true })).toMatchObject({ ok: false, status: 403 });
    expect(checkAdminAccess(apiOnly, 'Bearer x', { mutation: true })).toMatchObject({ ok: false, status: 401 });
    const withAdmin = { adminToken: 'a', apiToken: 'b', host: '0.0.0.0' };
    expect(checkAdminAccess(withAdmin, 'Bearer a', { mutation: true })).toEqual({ ok: true });
    const local = { adminToken: null, apiToken: null, host: '127.0.0.1' };
    expect(checkAdminAccess(local, undefined, { mutation: true, remoteAddress: '127.0.0.1' })).toEqual({ ok: true });
    expect(checkAdminAccess(local, undefined, { mutation: true, remoteAddress: '::1' })).toEqual({ ok: true });
    // túnel/reverse proxy no mesmo host chega como loopback, mas traz cabeçalhos de proxy
    expect(checkAdminAccess(local, undefined, { mutation: true, remoteAddress: '127.0.0.1', proxied: true })).toMatchObject({ ok: false, status: 403 });
    expect(checkAdminAccess(local, undefined, { mutation: true, remoteAddress: '10.0.0.7' })).toMatchObject({ ok: false, status: 403 });
  });

  it('modo local: cabeçalho de proxy fecha o /admin; chamada direta continua aberta', async () => {
    const { app } = await buildApp();
    expect((await app.inject({ method: 'GET', url: '/admin/llm' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/admin/llm', headers: { 'x-forwarded-for': '203.0.113.9' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/admin/llm', headers: { 'x-real-ip': '203.0.113.9' }, payload: { summaryEnabled: true } })).statusCode).toBe(403);
    await app.close();
  });

  it('com ADMIN_TOKEN, o API_TOKEN comum não abre /admin e o ADMIN_TOKEN não abre o resto', async () => {
    process.env.API_TOKEN = 'api-token';
    process.env.ADMIN_TOKEN = 'admin-token';
    const { app } = await buildApp();
    expect((await app.inject({ method: 'GET', url: '/admin/llm' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/admin/llm', headers: bearer('api-token') })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/admin/llm', headers: bearer('admin-token') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: '/admin/llm', headers: bearer('api-token'), payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/admin/llm/usage', headers: bearer('api-token') })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/admin/llm/test', headers: bearer('api-token'), payload: { provider: 'openai' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/sessions', headers: bearer('admin-token') })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/sessions', headers: bearer('api-token') })).statusCode).toBe(200);
    await app.close();
  });

  it('só com API_TOKEN, ele é o perfil admin; sem tokens e em host não-loopback, admin fica desligado', async () => {
    process.env.API_TOKEN = 'api-token';
    let built = await buildApp();
    expect((await built.app.inject({ method: 'GET', url: '/admin/llm' })).statusCode).toBe(401);
    expect((await built.app.inject({ method: 'GET', url: '/admin/llm', headers: bearer('api-token') })).statusCode).toBe(200);
    // o API_TOKEN comum (qualquer cliente) lê, mas não altera rotas, orçamento nem chaves
    expect((await built.app.inject({ method: 'PUT', url: '/admin/llm', headers: bearer('api-token'), payload: { budget: { monthlyUsd: 1 } } })).statusCode).toBe(403);
    expect((await built.app.inject({ method: 'POST', url: '/admin/llm/test', headers: bearer('api-token'), payload: { provider: 'openai' } })).statusCode).toBe(403);
    await built.app.close();

    delete process.env.API_TOKEN;
    process.env.HOST = '0.0.0.0';
    built = await buildApp();
    expect((await built.app.inject({ method: 'GET', url: '/admin/llm' })).statusCode).toBe(403);
    await built.app.close();
  });
});

describe('configuração pelo painel', () => {
  it('PUT recusa keyRef de outro provedor/serviço e GET lista só nomes permitidos (sem valores)', async () => {
    process.env.STRIPE_API_KEY = 'sk-stripe-TOPSECRET';
    const { app } = await buildApp();
    const bad = await app.inject({ method: 'PUT', url: '/admin/llm', payload: { keyRefs: { openai: 'STRIPE_API_KEY' } } });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/admin/llm', payload: { keyRefs: { openai: 'ANTHROPIC_API_KEY' } } })).statusCode).toBe(400);
    const view = (await app.inject({ method: 'GET', url: '/admin/llm' })).json();
    expect(view.providers.find((p: { id: string }) => p.id === 'openai').allowedKeyRefs).toEqual(['OPENAI_API_KEY']);
    expect(JSON.stringify([bad.json(), view])).not.toContain('sk-stripe-TOPSECRET');
    delete process.env.STRIPE_API_KEY;
    await app.close();
  });

  it('GET mostra provedores/tarefas sem expor chave; PUT valida, persiste e audita', async () => {
    const { app } = await buildApp();
    const initial = (await app.inject({ method: 'GET', url: '/admin/llm' })).json();
    expect(initial.providers.map((p: { id: string }) => p.id)).toEqual(['openai', 'openrouter', 'anthropic']);
    expect(initial.providers.every((p: { keyConfigured: boolean }) => p.keyConfigured)).toBe(true);
    const offline = initial.tasks.find((t: { id: string }) => t.id === 'transcription_offline');
    expect(offline).toMatchObject({ provider: 'openai', model: 'gpt-4o-transcribe', providerOptions: ['openai', 'openrouter'] });
    const summary = initial.tasks.find((t: { id: string }) => t.id === 'session_summary');
    expect(summary).toMatchObject({ enabled: false, providerOptions: ['openai', 'openrouter', 'anthropic'] });

    const bad = await app.inject({ method: 'PUT', url: '/admin/llm', payload: { routes: { transcription_offline: { provider: 'anthropic' } } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/sem STT/);

    const ok = await app.inject({
      method: 'PUT',
      url: '/admin/llm',
      payload: {
        routes: { transcription_offline: { provider: 'openrouter', model: 'openai/gpt-4o-transcribe' }, session_summary: { provider: 'anthropic', model: 'claude-haiku-5-5' } },
        summaryEnabled: true,
        budget: { monthlyUsd: 25, action: 'block' },
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().tasks.find((t: { id: string }) => t.id === 'transcription_offline').provider).toBe('openrouter');
    expect(ok.json().budget).toMatchObject({ monthlyUsd: 25, action: 'block' });

    const audit = (await app.inject({ method: 'GET', url: '/admin/llm/audit' })).json();
    expect(audit.entries[0].changes).toEqual(expect.arrayContaining(['routes.transcription_offline', 'summaryEnabled', 'budget']));

    const all = JSON.stringify([initial, ok.json(), audit, (await app.inject({ method: 'GET', url: '/config' })).json()]);
    for (const secret of [OPENAI, OPENROUTER, ANTHROPIC]) expect(all).not.toContain(secret);

    // Configuration survives a restart (file in DATA_DIR).
    await app.close();
    const again = await buildApp();
    const reread = (await again.app.inject({ method: 'GET', url: '/admin/llm' })).json();
    expect(reread.tasks.find((t: { id: string }) => t.id === 'transcription_offline').provider).toBe('openrouter');
    await again.app.close();
  });

  it('teste de conexão usa a chave do ambiente e não a devolve', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const { app } = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/admin/llm/test', payload: { provider: 'anthropic' } });
    expect(res.json()).toMatchObject({ ok: true, status: 200 });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.anthropic.com/v1/models?limit=1');
    expect(res.body).not.toContain(ANTHROPIC);
    expect((await app.inject({ method: 'POST', url: '/admin/llm/test', payload: { provider: 'nope' } })).statusCode).toBe(400);
    await app.close();
  });
});

async function recordExtensionChunk(app: Awaited<ReturnType<typeof buildApp>>['app']) {
  const session = (
    await app.inject({ method: 'POST', url: '/sessions', payload: { name: 'Revisão com custo', capture: 'extension', initialUrl: 'https://app.example/' } })
  ).json();
  await app.inject({ method: 'POST', url: `/sessions/${session.id}/start` });
  const audio = await app.inject({
    method: 'POST',
    url: `/sessions/${session.id}/audio`,
    headers: { 'content-type': 'application/octet-stream', 'x-client-id': 'chunk-1', 'x-chunk-start-ms': '0', 'x-chunk-duration-ms': '30000' },
    payload: Buffer.from('webm'),
  });
  return { session, audio };
}

describe('uso e custo por sessão', () => {
  it('transcrição offline segue a rota do admin, grava uso e o custo aparece no painel e na sessão', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: 'botão torto', segments: [{ text: 'botão torto', start: 0, end: 2 }] }) });
    vi.stubGlobal('fetch', fetchMock);
    const { app } = await buildApp();
    await app.inject({ method: 'PUT', url: '/admin/llm', payload: { routes: { transcription_offline: { provider: 'openrouter', model: 'openai/gpt-4o-transcribe' } } } });

    const { session, audio } = await recordExtensionChunk(app);
    expect(audio.json().transcribed).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
    expect(fetchMock.mock.calls[0]![1].headers).toEqual({ Authorization: `Bearer ${OPENROUTER}` });

    const perSession = (await app.inject({ method: 'GET', url: `/sessions/${session.id}/llm-usage` })).json();
    expect(perSession.audioSeconds).toBe(30);
    expect(perSession.costUsd).toBeCloseTo(0.003, 6);

    const usage = (await app.inject({ method: 'GET', url: '/admin/llm/usage' })).json();
    expect(usage.totals.costUsd).toBeCloseTo(0.003, 6);
    expect(usage.sessions[0]).toMatchObject({ sessionId: session.id, name: 'Revisão com custo' });
    expect((await app.inject({ method: 'GET', url: '/admin/llm/usage?month=2026-99' })).statusCode).toBe(400);
    expect(JSON.stringify(usage)).not.toContain(OPENROUTER);
    await app.close();
  });

  it('orçamento em modo block impede a chamada paga e informa budget_exceeded', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: 'x' }) });
    vi.stubGlobal('fetch', fetchMock);
    const { app } = await buildApp();
    await app.inject({ method: 'PUT', url: '/admin/llm', payload: { budget: { monthlyUsd: 0, action: 'block' } } });
    const { audio } = await recordExtensionChunk(app);
    expect(audio.json()).toMatchObject({ transcribed: false, error: 'budget_exceeded' });
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('teto em block com modelo sem tarifa recusa a transcrição offline (unpriced_model)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: 'x' }) });
    vi.stubGlobal('fetch', fetchMock);
    const { app } = await buildApp();
    await app.inject({
      method: 'PUT',
      url: '/admin/llm',
      payload: { budget: { monthlyUsd: 5, action: 'block' }, routes: { transcription_offline: { provider: 'openrouter', model: 'google/gemini-x-audio' } } },
    });
    const { audio } = await recordExtensionChunk(app);
    expect(audio.json()).toMatchObject({ transcribed: false, error: 'unpriced_model' });
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('sem chave da rota escolhida, falha fechado (nada de cair em outra chave)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    delete process.env.OPENROUTER_API_KEY;
    const { app } = await buildApp();
    await app.inject({ method: 'PUT', url: '/admin/llm', payload: { routes: { transcription_offline: { provider: 'openrouter' } } } });
    const { audio } = await recordExtensionChunk(app);
    expect(audio.json().error).toBe('no_api_key');
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('resumo opcional da sessão', () => {
  it('desabilitado por padrão (409); habilitado usa Anthropic e salva summary.json', async () => {
    process.env.USE_FAKE_TRANSCRIBER = 'true';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'Resumo da revisão.' }], usage: { input_tokens: 500, output_tokens: 100 } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { app } = await buildApp();
    const session = (await app.inject({ method: 'POST', url: '/sessions', payload: { name: 'Resumo', capture: 'extension', initialUrl: 'https://app.example/' } })).json();
    await app.inject({ method: 'POST', url: `/sessions/${session.id}/start` });
    await app.inject({ method: 'POST', url: `/sessions/${session.id}/stop` });

    const off = await app.inject({ method: 'POST', url: `/sessions/${session.id}/summary` });
    expect(off.statusCode).toBe(409);
    expect(off.json().error).toBe('summary_disabled');
    expect(fetchMock).not.toHaveBeenCalled();

    await app.inject({ method: 'PUT', url: '/admin/llm', payload: { summaryEnabled: true, routes: { session_summary: { provider: 'anthropic' } } } });
    const on = await app.inject({ method: 'POST', url: `/sessions/${session.id}/summary` });
    expect(on.statusCode).toBe(200);
    expect(on.json()).toMatchObject({ summary: 'Resumo da revisão.', provider: 'anthropic', model: 'claude-haiku-5-5' });
    expect(fetchMock.mock.calls[0]![1].headers['x-api-key']).toBe(ANTHROPIC);
    expect(on.body).not.toContain(ANTHROPIC);

    const saved = await app.inject({ method: 'GET', url: `/sessions/${session.id}/summary` });
    expect(saved.json().summary).toBe('Resumo da revisão.');
    const usage = (await app.inject({ method: 'GET', url: `/sessions/${session.id}/llm-usage` })).json();
    expect(usage.inputTokens).toBe(500);
    await app.close();
  });
});
