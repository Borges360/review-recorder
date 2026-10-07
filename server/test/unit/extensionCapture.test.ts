import { buildApp } from '../../src/index.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'rr-extension-'));
const previous = {
  sessions: process.env.SESSIONS_DIR,
  data: process.env.DATA_DIR,
  profile: process.env.BROWSER_PROFILE_DIR,
  fake: process.env.USE_FAKE_TRANSCRIBER,
  token: process.env.API_TOKEN,
};

beforeAll(() => {
  process.env.SESSIONS_DIR = join(root, 'sessions');
  process.env.DATA_DIR = join(root, 'data');
  process.env.BROWSER_PROFILE_DIR = join(root, 'profile');
  process.env.USE_FAKE_TRANSCRIBER = 'true';
  delete process.env.API_TOKEN;
});

afterAll(() => {
  restore('SESSIONS_DIR', previous.sessions);
  restore('DATA_DIR', previous.data);
  restore('BROWSER_PROFILE_DIR', previous.profile);
  restore('USE_FAKE_TRANSCRIBER', previous.fake);
  restore('API_TOKEN', previous.token);
});

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

it('grava uma revisão da extensão e compila REVIEW.md', async () => {
  const { app } = await buildApp();
  const created = await app.inject({
    method: 'POST',
    url: '/sessions',
    payload: { name: 'Revisão do contrato', capture: 'extension', initialUrl: 'https://app.example/contracts/42' },
  });
  expect(created.statusCode).toBe(200);
  const session = created.json();

  const started = await app.inject({ method: 'POST', url: `/sessions/${session.id}/start` });
  expect(started.json().status).toBe('RECORDING');
  expect(started.json().capture).toBe('extension');

  const click = {
    clientId: 'click-1',
    type: 'click',
    activeElapsedMs: 1200,
    elapsedMs: 1200,
    url: 'https://app.example/contracts/42',
    payload: {
      target: {
        tag: 'button',
        role: 'button',
        accessibleName: 'Salvar contrato',
        text: 'Salvar contrato',
        testId: 'save',
        id: 'save',
        name: null,
        bounds: { x: 1, y: 2, width: 10, height: 10 },
      },
    },
  };
  const first = await app.inject({
    method: 'POST',
    url: `/sessions/${session.id}/events`,
    payload: {
      events: [
        {
          clientId: 'screen-1',
          type: 'screen-state',
          activeElapsedMs: 1000,
          elapsedMs: 1000,
          url: 'https://app.example/contracts/42',
          payload: {
            title: 'Contrato',
            clickables: [click.payload.target, { tag: 'input', role: 'textbox', accessibleName: 'Senha', name: 'password', inputType: 'password', text: 'segredo', testId: null, id: null, bounds: null }],
          },
        },
        click,
      ],
    },
  });
  expect(first.json().accepted).toEqual(['screen-1', 'click-1']);

  const again = await app.inject({
    method: 'POST',
    url: `/sessions/${session.id}/events`,
    payload: { events: [click] },
  });
  expect(again.json().duplicates).toEqual(['click-1']);

  const audio = await app.inject({
    method: 'POST',
    url: `/sessions/${session.id}/audio`,
    headers: {
      'content-type': 'application/octet-stream',
      'x-client-id': 'chunk-1',
      'x-chunk-start-ms': '0',
      'x-chunk-duration-ms': '5000',
    },
    payload: Buffer.from('webm'),
  });
  expect(audio.statusCode).toBe(200);
  expect(audio.json().transcribed).toBe(true);

  const shot = await app.inject({
    method: 'POST',
    url: `/sessions/${session.id}/screenshot`,
    headers: {
      'content-type': 'application/octet-stream',
      'x-client-id': 'shot-1',
      'x-elapsed-ms': '1500',
      'x-active-elapsed-ms': '1500',
    },
    payload: png,
  });
  expect(shot.statusCode).toBe(200);
  expect(shot.json().speechSegmentId).toBeTruthy();
  expect(shot.json().file).toContain('review-recorder/');

  const image = await app.inject({ method: 'GET', url: `/sessions/${session.id}/evidence/shot-1` });
  expect(image.statusCode).toBe(200);
  expect(image.headers['content-type']).toContain('image/png');

  const stopped = await app.inject({ method: 'POST', url: `/sessions/${session.id}/stop` });
  expect(stopped.json().status).toBe('COMPLETED');

  const exported = await app.inject({ method: 'GET', url: `/sessions/${session.id}/export` });
  expect(exported.json().reviewMd).toContain('Salvar contrato');
  expect(exported.json().reviewMd).toContain('comentário');
  expect(exported.json().reviewMd).toContain('sobre a tela');
  expect(exported.json().reviewMd).not.toContain('segredo');

  const page = await app.inject({ method: 'GET', url: '/' });
  expect(page.statusCode).toBe(200);
  expect(page.body).toContain('Histórico');

  await app.close();
});

it('recusa a API sem bearer quando API_TOKEN está definido', async () => {
  process.env.API_TOKEN = 'secret-token';
  const { app } = await buildApp();
  const health = await app.inject({ method: 'GET', url: '/health' });
  expect(health.statusCode).toBe(200);
  const denied = await app.inject({ method: 'GET', url: '/sessions' });
  expect(denied.statusCode).toBe(401);
  const allowed = await app.inject({
    method: 'GET',
    url: '/sessions',
    headers: { authorization: 'Bearer secret-token' },
  });
  expect(allowed.statusCode).toBe(200);
  const history = await app.inject({ method: 'GET', url: '/' });
  expect(history.statusCode).toBe(200);
  await app.close();
  delete process.env.API_TOKEN;
});
