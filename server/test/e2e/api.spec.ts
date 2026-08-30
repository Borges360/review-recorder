import { test, expect } from '@playwright/test';
import { buildApp } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let baseUrl: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  process.env.OPENAI_API_KEY = '';
  process.env.DATA_DIR = './test-data-e2e';
  process.env.SESSIONS_DIR = './test-sessions-e2e';
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

test('API session lifecycle without browser', async ({ request }) => {
  const createRes = await request.post(`${baseUrl}/sessions`, {
    data: { name: 'Test Session', initialUrl: `${baseUrl}/demo/` },
  });
  expect(createRes.ok()).toBeTruthy();
  const session = await createRes.json();
  expect(session.id).toBeTruthy();
  expect(session.status).toBe('CREATED');

  const listRes = await request.get(`${baseUrl}/sessions`);
  expect(listRes.ok()).toBeTruthy();
  const list = await listRes.json();
  expect(list.length).toBeGreaterThan(0);
});

test('demo app serves pages', async ({ page }) => {
  await page.goto(`${baseUrl}/demo/`);
  await expect(page.getByRole('heading', { name: 'Listagem de contratos' })).toBeVisible();
  await page.getByTestId('create-contract').click();
  await expect(page.getByRole('heading', { name: 'Novo contrato' })).toBeVisible();
});

test('demo wizard navigates steps via same URL', async ({ page }) => {
  await page.goto(`${baseUrl}/demo/wizard.html?step=1`);
  await expect(page.getByText('Etapa 1 de 10')).toBeVisible();
  await page.getByTestId('wizard-next').click();
  await expect(page.getByText('Etapa 2 de 10')).toBeVisible();
  expect(page.url()).toContain('step=2');
});
