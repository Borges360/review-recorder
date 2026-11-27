/* global window, document, Event */

import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sidepanelUrl = pathToFileURL(path.join(extensionRoot, 'dist', 'sidepanel.html')).href;
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

async function openSidepanel(options = {}) {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 } });
  await context.addInitScript((config) => {
    const state = {
      messages: [],
      tabs: [],
      openedOptions: 0,
      writes: [],
      failSet: Boolean(config.failSet),
      storage: config.storage ?? {
        apiBaseUrl: 'https://history.example.test',
        uiLanguage: config.uiLanguage,
      },
      queryMode: config.queryMode ?? 'ok',
      actionMode: config.actionMode ?? 'ok',
      resolveAction: null,
      resolveQuery: null,
    };
    Object.defineProperty(window, '__rr', { value: state });
    window.chrome = {
      runtime: {
        sendMessage(message) {
          state.messages.push(JSON.parse(JSON.stringify(message)));
          if (message.type === 'query-recording') {
            if (state.queryMode === 'fail')
              return Promise.reject(new Error('synthetic startup failure marker'));
            if (state.queryMode === 'hold') {
              return new Promise((resolve) => {
                state.resolveQuery = resolve;
              });
            }
            return Promise.resolve({ recording: false });
          }
          if (state.actionMode === 'hold') {
            return new Promise((resolve) => {
              state.resolveAction = resolve;
            });
          }
          if (state.actionMode === 'fail')
            return Promise.reject(new Error('synthetic action failure marker'));
          return Promise.resolve({ ok: true });
        },
        async openOptionsPage() {
          state.openedOptions += 1;
        },
      },
      storage: {
        local: {
          async get() {
            return { ...state.storage };
          },
          async set(next) {
            if (state.failSet) throw new Error('synthetic storage failure marker');
            state.writes.push({ ...next });
            Object.assign(state.storage, next);
          },
        },
      },
      tabs: {
        async create(value) {
          state.tabs.push({ ...value });
        },
      },
    };
  }, options);
  const page = await context.newPage();
  await page.goto(sidepanelUrl);
  await page.locator('#status').waitFor();
  return { context, page };
}

async function waitForStatus(page, expected) {
  await page.waitForFunction(
    (value) => document.querySelector('#status')?.textContent === value,
    expected,
  );
}

test('all CT52 actions remain usable when startup state lookup fails', async () => {
  const { context, page } = await openSidepanel({ queryMode: 'fail' });
  try {
    await waitForStatus(page, 'Could not check the current state. Actions are still available.');
    await page.locator('#name').fill('Revisão São Paulo — 東京');

    const actions = [
      ['start', 'Recording.'],
      ['pause', 'Paused.'],
      ['resume', 'Recording.'],
      ['shot', 'Screenshot requested.'],
      ['stop', 'Review finished.'],
    ];
    for (const [button, status] of actions) {
      await page.locator(`#${button}`).click();
      await waitForStatus(page, status);
    }
    const messages = await page.evaluate(() =>
      window.__rr.messages.filter((item) => item.type !== 'query-recording'),
    );
    assert.deepEqual(
      messages.map((item) => item.type),
      ['start', 'pause', 'resume', 'screenshot', 'stop'],
    );
    assert.equal(messages[0].name, 'Revisão São Paulo — 東京');

    await page.locator('#history').click();
    await waitForStatus(page, 'History opened.');
    await page.locator('#options').click();
    await page.waitForFunction(() => window.__rr.openedOptions === 1);
    const panelState = await page.evaluate(() => ({
      tabs: window.__rr.tabs,
      openedOptions: window.__rr.openedOptions,
    }));
    assert.equal(panelState.tabs[0].url, 'https://history.example.test');
    assert.equal(panelState.openedOptions, 1);
  } finally {
    await context.close();
  }
});

test('cancel stops UI waiting and ignores a late dispatched-command result', async () => {
  const { context, page } = await openSidepanel({ actionMode: 'hold' });
  try {
    await waitForStatus(page, 'Ready.');
    await page.locator('#start').click();
    await waitForStatus(page, 'Sending command…');
    assert.equal(await page.locator('#cancel-action').isVisible(), true);
    await page.locator('#cancel-action').click();
    const cancelled =
      'The command was sent, but its result is unconfirmed. Check the state before trying again.';
    await waitForStatus(page, cancelled);
    assert.equal(await page.locator('#start').isEnabled(), true);
    await page.evaluate(() => window.__rr.resolveAction?.({ ok: true }));
    await page.waitForTimeout(25);
    await waitForStatus(page, cancelled);
  } finally {
    await context.close();
  }
});

test('Escape cancels UI wait and the action can be retried', async () => {
  const { context, page } = await openSidepanel({ actionMode: 'hold' });
  try {
    await waitForStatus(page, 'Ready.');
    await page.locator('#pause').click();
    await waitForStatus(page, 'Sending command…');
    await page.keyboard.press('Escape');
    const cancelled =
      'The command was sent, but its result is unconfirmed. Check the state before trying again.';
    await waitForStatus(page, cancelled);
    await page.evaluate(() => window.__rr.resolveAction?.({ ok: true }));
    await page.waitForTimeout(25);
    await page.evaluate(() => {
      window.__rr.actionMode = 'ok';
    });
    await page.locator('#resume').click();
    await waitForStatus(page, 'Recording.');
  } finally {
    await context.close();
  }
});

test('startup query result arriving after pagehide is ignored', async () => {
  const { context, page } = await openSidepanel({ queryMode: 'hold' });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.evaluate(() => window.__rr.resolveQuery?.({ recording: true }));
    await page.waitForTimeout(25);
    assert.equal(await page.locator('#status').textContent(), 'Ready.');
  } finally {
    await context.close();
  }
});

test('side panel has no horizontal overflow in English or Brazilian Portuguese', async () => {
  const { context, page } = await openSidepanel();
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
          `side panel overflowed in ${locale} at ${width}px`,
        );
      }
    }
  } finally {
    await context.close();
  }
});

test('side panel defaults to English and saves a project-local language without losing the review name', async () => {
  const { context, page } = await openSidepanel();
  let savedStorage;
  try {
    await waitForStatus(page, 'Ready.');
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('#start').textContent(), 'Record');
    assert.equal(await page.locator('#name').inputValue(), 'Review');

    await page.locator('#name').fill('Release review — São Paulo');
    await page.locator('#language').selectOption('pt-BR');
    await waitForStatus(page, 'Preferência de idioma salva.');
    assert.equal(await page.locator('html').getAttribute('lang'), 'pt-BR');
    assert.equal(await page.locator('#start').textContent(), 'Gravar');
    assert.equal(await page.locator('#name').inputValue(), 'Release review — São Paulo');
    const state = await page.evaluate(() => ({
      storage: window.__rr.storage,
      writes: window.__rr.writes,
    }));
    assert.equal(state.storage.apiBaseUrl, 'https://history.example.test');
    assert.deepEqual(state.writes, [{ uiLanguage: 'pt-BR' }]);
    savedStorage = state.storage;
  } finally {
    await context.close();
  }

  const reopened = await openSidepanel({ storage: savedStorage });
  try {
    await reopened.page.waitForFunction(
      () => document.querySelector('#language')?.value === 'pt-BR',
    );
    assert.equal(await reopened.page.locator('html').getAttribute('lang'), 'pt-BR');
    assert.equal(await reopened.page.locator('#history').textContent(), 'Abrir histórico');
  } finally {
    await reopened.context.close();
  }
});

test('side panel keeps the translated default name in sync until the user edits it', async () => {
  const { context, page } = await openSidepanel();
  try {
    await waitForStatus(page, 'Ready.');
    await page.locator('#language').selectOption('pt-BR');
    await waitForStatus(page, 'Preferência de idioma salva.');
    assert.equal(await page.locator('#name').inputValue(), 'Revisão');
    await page.locator('#language').selectOption('en');
    await waitForStatus(page, 'Language preference saved.');
    assert.equal(await page.locator('#name').inputValue(), 'Review');
  } finally {
    await context.close();
  }
});

test('invalid side-panel locale falls back visibly; failed language writes keep the prior locale', async () => {
  const invalid = await openSidepanel({ uiLanguage: 'es' });
  try {
    await waitForStatus(invalid.page, 'Unsupported saved language; using English.');
    assert.equal(await invalid.page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await invalid.page.locator('#language').inputValue(), 'en');
    assert.deepEqual(await invalid.page.evaluate(() => window.__rr.writes), []);
  } finally {
    await invalid.context.close();
  }

  const failed = await openSidepanel({ failSet: true });
  try {
    await waitForStatus(failed.page, 'Ready.');
    await failed.page.locator('#name').fill('Keep my draft');
    await failed.page.locator('#language').selectOption('pt-BR');
    await waitForStatus(
      failed.page,
      'Could not save the language preference. The previous language is still selected.',
    );
    assert.equal(await failed.page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await failed.page.locator('#name').inputValue(), 'Keep my draft');
    assert.deepEqual(await failed.page.evaluate(() => window.__rr.writes), []);
  } finally {
    await failed.context.close();
  }
});
