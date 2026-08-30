import { test, expect } from '@playwright/test';
import { buildApp } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let app: FastifyInstance;
let baseUrl: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  process.env.OPENAI_API_KEY = '';
  process.env.USE_FAKE_TRANSCRIBER = 'true';
  process.env.MOCK_BROWSER = 'true';
  process.env.DATA_DIR = './test-data-e2e-recorder';
  process.env.SESSIONS_DIR = './test-sessions-e2e-recorder';
  const built = await buildApp();
  app = built.app;
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 3000;
  baseUrl = `http://127.0.0.1:${port}`;
});

test.afterAll(async () => {
  await app.close();
});

function sendFakeAudio(sessionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/sessions/${sessionId}/audio`);
    ws.on('open', () => {
      const pcm = Buffer.alloc(4800, 0); // ~100ms silence at 24kHz mono PCM16
      ws.send(pcm);
      setTimeout(() => {
        ws.close();
        resolve();
      }, 200);
    });
    ws.on('error', reject);
  });
}

test('full recorder flow with fake transcriber and mock browser', async ({ request }) => {
  const createRes = await request.post(`${baseUrl}/sessions`, {
    data: { name: 'Gerar contrato', initialUrl: `${baseUrl}/demo/`, description: 'E2E test' },
  });
  expect(createRes.ok()).toBeTruthy();
  const session = await createRes.json();
  expect(session.description).toBe('E2E test');

  const startRes = await request.post(`${baseUrl}/sessions/${session.id}/start`);
  expect(startRes.ok()).toBeTruthy();

  await request.post(`${baseUrl}/sessions/${session.id}/test/screen-state`, {
    data: {
      fingerprint: 'fp-listagem',
      url: `${baseUrl}/demo/`,
      normalizedRoute: '/demo/',
      title: 'Listagem de contratos',
      ariaSnapshot: '- heading "Listagem de contratos"',
      dialogs: [],
      isNew: true,
    },
  });

  await request.post(`${baseUrl}/sessions/${session.id}/test/browser-event`, {
    data: {
      type: 'click',
      payload: {
        url: `${baseUrl}/demo/`,
        target: {
          tag: 'button',
          role: 'button',
          accessibleName: 'Gerar contrato',
          text: 'Gerar contrato',
          testId: 'create-contract',
        },
      },
    },
  });

  await sendFakeAudio(session.id);

  await request.post(`${baseUrl}/sessions/${session.id}/screenshot`);

  await request.post(`${baseUrl}/sessions/${session.id}/test/screen-state`, {
    data: {
      fingerprint: 'fp-wizard-1',
      url: `${baseUrl}/demo/wizard.html?step=1`,
      normalizedRoute: '/demo/wizard.html',
      title: 'Modal — Etapa 1 de 10',
      ariaSnapshot: '- dialog "Wizard"\n  - text "Etapa 1 de 10"',
      dialogs: ['Wizard'],
      isNew: true,
    },
  });

  await request.post(`${baseUrl}/sessions/${session.id}/pause`);
  await new Promise((r) => setTimeout(r, 100));
  await request.post(`${baseUrl}/sessions/${session.id}/resume`);

  await sendFakeAudio(session.id);

  const stopRes = await request.post(`${baseUrl}/sessions/${session.id}/stop`);
  expect(stopRes.ok()).toBeTruthy();
  const stopped = await stopRes.json();
  expect(stopped.status).toBe('COMPLETED');
  expect(stopped.outputDir).toBeTruthy();

  const outputDir = stopped.outputDir as string;
  expect(existsSync(join(outputDir, 'REVIEW.md'))).toBeTruthy();
  expect(existsSync(join(outputDir, 'review.json'))).toBeTruthy();
  expect(existsSync(join(outputDir, 'raw/events.jsonl'))).toBeTruthy();

  const review = JSON.parse(readFileSync(join(outputDir, 'review.json'), 'utf8'));
  expect(review.timeline.length).toBeGreaterThan(0);
  expect(review.timeline.some((e: { type: string }) => e.type === 'observation')).toBeTruthy();
  expect(review.timeline.some((e: { type: string }) => e.type === 'pause')).toBeTruthy();

  const timelineRes = await request.get(`${baseUrl}/sessions/${session.id}/timeline`);
  expect(timelineRes.ok()).toBeTruthy();
  const timeline = await timelineRes.json();
  expect(timeline.timeline.length).toBeGreaterThan(0);

  const md = readFileSync(join(outputDir, 'REVIEW.md'), 'utf8');
  expect(md).toContain('UI Review');
});
