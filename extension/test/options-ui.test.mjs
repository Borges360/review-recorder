/* global window, document, Headers */

import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const optionsUrl = pathToFileURL(path.join(extensionRoot, 'dist', 'options.html')).href;
let browser;

before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox'],
  });
});

after(async () => {
  await browser?.close();
});

async function openOptions(options = {}) {
  const context = await browser.newContext({ viewport: { width: 640, height: 800 } });
  await context.addInitScript((config) => {
    const state = {
      settings: config.settings ?? { apiBaseUrl: 'https://saved.example.test', apiToken: '' },
      writes: [],
      fetchCalls: [],
      failSet: Boolean(config.failSet),
      fetchMode: config.fetchMode ?? 'ok',
      fetchStatus: config.fetchStatus ?? 200,
      resolveFetch: null,
    };
    Object.defineProperty(window, '__rr', { value: state });
    window.chrome = {
      storage: {
        local: {
          async get() {
            return { ...state.settings };
          },
          async set(next) {
            if (state.failSet) throw new Error('synthetic storage failure marker');
            state.writes.push({ ...next });
            Object.assign(state.settings, next);
          },
        },
      },
    };
    window.fetch = (input, init = {}) => {
      state.fetchCalls.push({
        url: String(input),
        authorization: new Headers(init.headers).get('Authorization'),
        signal: init.signal,
      });
      if (state.fetchMode === 'hold') {
        return new Promise((resolve) => {
          state.resolveFetch = () => resolve({ ok: true, status: 200 });
        });
      }
      if (state.fetchMode === 'reject')
        return Promise.reject(new Error('synthetic fetch failure marker'));
      return Promise.resolve({ ok: state.fetchStatus < 400, status: state.fetchStatus });
    };
  }, options);
  const page = await context.newPage();
  await page.goto(optionsUrl);
  await page.locator('#result').waitFor();
  return { context, page };
}

async function waitForStatus(page, expected) {
  await page.waitForFunction(
    (value) => document.querySelector('#result')?.textContent === value,
    expected,
  );
}

test('keeps edits as a draft until explicit save and supports Escape discard and Ctrl+S', async () => {
  const { context, page } = await openOptions({
    settings: { apiBaseUrl: 'https://saved.example.test', apiToken: 'synthetic-saved-token' },
  });
  try {
    await waitForStatus(page, 'Settings loaded.');
    await page.locator('#base').fill('https://draft.example.test');
    await page.locator('#token').fill('synthetic-draft-token');
    assert.equal(await page.evaluate(() => window.__rr.writes.length), 0);

    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#base').inputValue(), 'https://saved.example.test');
    assert.equal(await page.locator('#token').inputValue(), 'synthetic-saved-token');
    await waitForStatus(page, 'Changes discarded.');
    assert.equal(await page.evaluate(() => window.__rr.writes.length), 0);

    await page.locator('#base').fill('https://new.example.test/');
    await page.locator('#token').fill('synthetic-new-token');
    await page.keyboard.press('Control+s');
    await waitForStatus(page, 'Settings saved.');
    const writes = await page.evaluate(() => window.__rr.writes);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].apiBaseUrl, 'https://new.example.test');
    assert.equal(writes[0].apiToken, 'synthetic-new-token');
  } finally {
    await context.close();
  }
});

test('rejects invalid URLs and preserves the draft after storage failure', async () => {
  const { context, page } = await openOptions({ failSet: true });
  try {
    await waitForStatus(page, 'Settings loaded.');
    await page.locator('#base').fill('javascript:alert(1)');
    await page.locator('#save').click();
    await waitForStatus(page, 'Enter a valid HTTP or HTTPS URL without a username or password.');
    assert.equal(await page.evaluate(() => window.__rr.writes.length), 0);

    await page.locator('#base').fill('https://draft.example.test');
    await page.locator('#token').fill('synthetic-draft-token');
    await page.locator('#save').click();
    await waitForStatus(page, 'Could not save. Your draft is still available to retry.');
    assert.equal(await page.locator('#base').inputValue(), 'https://draft.example.test');
    assert.equal(await page.locator('#token').inputValue(), 'synthetic-draft-token');
    assert.equal(
      await page
        .locator('body')
        .innerText()
        .then((value) => value.includes('synthetic storage failure marker')),
      false,
    );
  } finally {
    await context.close();
  }
});

test('uses only the mocked API fetch and keeps API responses and credentials out of status text', async () => {
  const { context, page } = await openOptions({ fetchStatus: 503 });
  try {
    await waitForStatus(page, 'Settings loaded.');
    await page.locator('#token').fill('synthetic-api-token');
    await page.locator('#test').click();
    await waitForStatus(page, 'The API returned HTTP 503.');
    const call = await page.evaluate(() => window.__rr.fetchCalls[0]);
    assert.equal(call.url, 'https://saved.example.test/sessions?limit=1');
    assert.equal(call.authorization, 'Bearer synthetic-api-token');
    assert.equal(
      (await page.locator('#result').textContent()).includes('synthetic-api-token'),
      false,
    );
    assert.equal(
      (await page.locator('#result').textContent()).includes('synthetic fetch failure marker'),
      false,
    );
  } finally {
    await context.close();
  }
});

test('cancels API-test UI state and ignores a late mocked response', async () => {
  const { context, page } = await openOptions({ fetchMode: 'hold' });
  try {
    await waitForStatus(page, 'Settings loaded.');
    await page.locator('#test').click();
    await page.waitForFunction(() => window.__rr.fetchCalls.length === 1);
    await page.locator('#cancel-test').click();
    await waitForStatus(page, 'Test canceled.');
    assert.equal(await page.locator('#test').isEnabled(), true);
    assert.equal(await page.locator('#cancel-test').isVisible(), false);
    await page.evaluate(() => window.__rr.resolveFetch?.());
    await page.waitForTimeout(25);
    await waitForStatus(page, 'Test canceled.');
    assert.equal(await page.evaluate(() => window.__rr.fetchCalls[0].signal.aborted), true);
  } finally {
    await context.close();
  }
});

test('options layout has no horizontal overflow in English or Brazilian Portuguese', async () => {
  const { context, page } = await openOptions();
  try {
    for (const [locale, savedStatus] of [
      ['en', 'Language preference saved.'],
      ['pt-BR', 'Preferência de idioma salva.'],
    ]) {
      if (locale === 'pt-BR') {
        await page.locator('#language').selectOption(locale);
        await waitForStatus(page, savedStatus);
      }
      for (const width of [320, 640, 960]) {
        await page.setViewportSize({ width, height: 800 });
        const dimensions = await page.evaluate(() => ({
          client: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        assert.ok(
          dimensions.scroll <= dimensions.client,
          `options layout overflowed in ${locale} at ${width}px`,
        );
      }
    }
  } finally {
    await context.close();
  }
});

test('defaults to English and persists Brazilian Portuguese without replacing the API draft', async () => {
  const { context, page } = await openOptions({
    settings: { apiBaseUrl: 'https://saved.example.test', apiToken: 'saved-token' },
  });
  let reopened;
  try {
    await waitForStatus(page, 'Settings loaded.');
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('#language').inputValue(), 'en');
    assert.equal(await page.locator('[for="base"] span').textContent(), 'API URL');

    await page.locator('#base').fill('https://draft.example.test');
    await page.locator('#token').fill('draft-token');
    await page.locator('#language').selectOption('pt-BR');
    await waitForStatus(page, 'Preferência de idioma salva.');

    assert.equal(await page.locator('html').getAttribute('lang'), 'pt-BR');
    assert.equal(await page.locator('[for="base"] span').textContent(), 'URL da API');
    assert.equal(await page.locator('#base').inputValue(), 'https://draft.example.test');
    assert.equal(await page.locator('#token').inputValue(), 'draft-token');
    const state = await page.evaluate(() => ({
      settings: window.__rr.settings,
      writes: window.__rr.writes,
    }));
    assert.equal(state.settings.apiBaseUrl, 'https://saved.example.test');
    assert.equal(state.settings.apiToken, 'saved-token');
    assert.deepEqual(state.writes, [{ uiLanguage: 'pt-BR' }]);
    reopened = { settings: state.settings };
  } finally {
    await context.close();
  }

  const reopenedPage = await openOptions(reopened);
  try {
    await waitForStatus(reopenedPage.page, 'Configurações carregadas.');
    assert.equal(await reopenedPage.page.locator('html').getAttribute('lang'), 'pt-BR');
    assert.equal(await reopenedPage.page.locator('#language').inputValue(), 'pt-BR');
  } finally {
    await reopenedPage.context.close();
  }
});

test('unsupported saved locales visibly fall back to English without rewriting the preference', async () => {
  const { context, page } = await openOptions({
    settings: { apiBaseUrl: 'https://saved.example.test', apiToken: '', uiLanguage: 'es' },
  });
  try {
    await waitForStatus(page, 'Unsupported saved language; using English.');
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('#language').inputValue(), 'en');
    assert.deepEqual(await page.evaluate(() => window.__rr.writes), []);
  } finally {
    await context.close();
  }
});

test('failed language save restores the previous language and preserves the API draft', async () => {
  const { context, page } = await openOptions({
    failSet: true,
    settings: { apiBaseUrl: 'https://saved.example.test', apiToken: 'saved-token' },
  });
  try {
    await waitForStatus(page, 'Settings loaded.');
    await page.locator('#base').fill('https://draft.example.test');
    await page.locator('#token').fill('draft-token');
    await page.locator('#language').selectOption('pt-BR');
    await waitForStatus(
      page,
      'Could not save the language preference. The previous language is still selected.',
    );
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('#language').inputValue(), 'en');
    assert.equal(await page.locator('#base').inputValue(), 'https://draft.example.test');
    assert.equal(await page.locator('#token').inputValue(), 'draft-token');
    assert.deepEqual(await page.evaluate(() => window.__rr.writes), []);
  } finally {
    await context.close();
  }
});
