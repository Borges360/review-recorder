import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, resolveLanguage, translate } from './i18n.mjs';

const DEFAULT_API_BASE_URL = 'https://review.luizfelipeborges.dev';

const baseInput = document.querySelector<HTMLInputElement>('#base');
const tokenInput = document.querySelector<HTMLInputElement>('#token');
const languageSelect = document.querySelector<HTMLSelectElement>('#language');
const saveButton = document.querySelector<HTMLButtonElement>('#save');
const discardButton = document.querySelector<HTMLButtonElement>('#discard');
const testButton = document.querySelector<HTMLButtonElement>('#test');
const cancelTestButton = document.querySelector<HTMLButtonElement>('#cancel-test');
const result = document.querySelector<HTMLElement>('#result');

interface SettingsDraft {
  apiBaseUrl: string;
  apiToken: string;
}

let saved: SettingsDraft = { apiBaseUrl: DEFAULT_API_BASE_URL, apiToken: '' };
let activeTest: AbortController | null = null;
let saving = false;
let savingLanguage = false;
let disposed = false;
let language = DEFAULT_LANGUAGE;
let savedLanguage = DEFAULT_LANGUAGE;
let statusMessage: { key: string; values?: Record<string, string | number> } | null = null;

if (
  baseInput &&
  tokenInput &&
  languageSelect &&
  saveButton &&
  discardButton &&
  testButton &&
  cancelTestButton
) {
  baseInput.value = DEFAULT_API_BASE_URL;

  function show(key: string, values?: Record<string, string | number>): void {
    statusMessage = { key, values };
    if (result && !disposed) result.textContent = translate(language, key, values);
  }

  function applyLanguage(next: string): void {
    language = next;
    document.documentElement.lang = next;
    document.title = translate(language, 'optionsTitle');
    for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
      const key = element.dataset.i18n;
      if (key) element.textContent = translate(language, key);
    }
    for (const element of document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
      const key = element.dataset.i18nAriaLabel;
      if (key) element.setAttribute('aria-label', translate(language, key));
    }
    languageSelect.value = language;
    if (result && statusMessage && !disposed) {
      result.textContent = translate(language, statusMessage.key, statusMessage.values);
    }
  }

  async function saveLanguage(): Promise<void> {
    if (savingLanguage || disposed) return;
    const previous = savedLanguage;
    const requested = resolveLanguage(languageSelect.value).language;
    if (requested === previous) {
      applyLanguage(previous);
      return;
    }
    savingLanguage = true;
    languageSelect.disabled = true;
    applyLanguage(requested);
    try {
      await chrome.storage.local.set({ [LANGUAGE_STORAGE_KEY]: requested });
      if (disposed) return;
      savedLanguage = requested;
      show('languageSaved');
    } catch {
      if (disposed) return;
      applyLanguage(previous);
      show('languageSaveFailed');
    } finally {
      savingLanguage = false;
      if (!disposed) languageSelect.disabled = false;
    }
  }

  function currentDraft(): SettingsDraft {
    return { apiBaseUrl: baseInput.value, apiToken: tokenInput.value };
  }

  function isDirty(): boolean {
    const current = currentDraft();
    return current.apiBaseUrl !== saved.apiBaseUrl || current.apiToken !== saved.apiToken;
  }

  function normalizeApiBase(value: string): string {
    const candidate = value.trim();
    if (!candidate) throw new Error('invalid-url');
    const url = new URL(candidate);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      throw new Error('invalid-url');
    }
    return url.toString().replace(/\/+$/, '');
  }

  function finishTestState(): void {
    activeTest = null;
    testButton.disabled = false;
    cancelTestButton.hidden = true;
  }

  function cancelTest(message = 'testCanceled'): void {
    const controller = activeTest;
    if (!controller) return;
    activeTest = null;
    controller.abort();
    testButton.disabled = false;
    cancelTestButton.hidden = true;
    show(message);
  }

  function discardDraft(): void {
    cancelTest();
    baseInput.value = saved.apiBaseUrl;
    tokenInput.value = saved.apiToken;
    show('changesDiscarded');
  }

  async function loadSettings(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get([
        'apiBaseUrl',
        'apiToken',
        LANGUAGE_STORAGE_KEY,
      ]);
      if (disposed) return;
      const locale = resolveLanguage(stored[LANGUAGE_STORAGE_KEY]);
      savedLanguage = locale.language;
      applyLanguage(locale.language);
      saved = {
        apiBaseUrl: String(stored.apiBaseUrl ?? DEFAULT_API_BASE_URL),
        apiToken: String(stored.apiToken ?? ''),
      };
      baseInput.value = saved.apiBaseUrl;
      tokenInput.value = saved.apiToken;
      show(locale.unsupported ? 'unsupportedLanguage' : 'settingsLoaded');
    } catch {
      show('loadFailed');
    }
  }

  async function saveSettings(): Promise<void> {
    if (saving || disposed) return;
    let apiBaseUrl: string;
    try {
      apiBaseUrl = normalizeApiBase(baseInput.value);
    } catch {
      show('invalidUrl');
      baseInput.focus();
      return;
    }

    saving = true;
    saveButton.disabled = true;
    try {
      const next = { apiBaseUrl, apiToken: tokenInput.value.trim() };
      await chrome.storage.local.set(next);
      if (disposed) return;
      saved = next;
      baseInput.value = next.apiBaseUrl;
      tokenInput.value = next.apiToken;
      show('settingsSaved');
    } catch {
      show('saveFailed');
    } finally {
      saving = false;
      if (!disposed) saveButton.disabled = false;
    }
  }

  async function testApi(): Promise<void> {
    if (activeTest || disposed) return;
    let apiBaseUrl: string;
    try {
      apiBaseUrl = normalizeApiBase(baseInput.value);
    } catch {
      show('invalidUrlBeforeTest');
      baseInput.focus();
      return;
    }

    const controller = new AbortController();
    activeTest = controller;
    testButton.disabled = true;
    cancelTestButton.hidden = false;
    show('testApiProgress');

    try {
      const headers = new Headers();
      const token = tokenInput.value.trim();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const response = await fetch(`${apiBaseUrl}/sessions?limit=1`, {
        headers,
        signal: controller.signal,
      });
      if (disposed || activeTest !== controller) return;
      if (response.ok) show('apiAccessible');
      else show('apiResponseStatus', { status: response.status });
    } catch {
      if (disposed || activeTest !== controller) return;
      show('apiFailed');
    } finally {
      if (activeTest === controller) finishTestState();
    }
  }

  saveButton.addEventListener('click', () => void saveSettings());
  languageSelect.addEventListener('change', () => void saveLanguage());
  discardButton.addEventListener('click', discardDraft);
  testButton.addEventListener('click', () => void testApi());
  cancelTestButton.addEventListener('click', () => cancelTest());

  chrome.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[LANGUAGE_STORAGE_KEY] || disposed) return;
    const locale = resolveLanguage(changes[LANGUAGE_STORAGE_KEY].newValue);
    savedLanguage = locale.language;
    applyLanguage(locale.language);
    if (locale.unsupported) show('unsupportedLanguage');
  });

  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (activeTest) cancelTest();
      else if (isDirty()) discardDraft();
      return;
    }
    if (event.key.toLowerCase() === 's' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void saveSettings();
    }
  });

  window.addEventListener('pagehide', () => {
    disposed = true;
    activeTest?.abort();
    activeTest = null;
  });

  void loadSettings();
}
