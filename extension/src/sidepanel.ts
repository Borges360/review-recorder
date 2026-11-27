import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, resolveLanguage, translate } from './i18n.mjs';

const status = document.querySelector<HTMLElement>('#status');
const nameInput = document.querySelector<HTMLInputElement>('#name');
const languageSelect = document.querySelector<HTMLSelectElement>('#language');
const cancelButton = document.querySelector<HTMLButtonElement>('#cancel-action');
const actionButtons = ['#start', '#pause', '#resume', '#shot', '#stop']
  .map((selector) => document.querySelector<HTMLButtonElement>(selector))
  .filter((button): button is HTMLButtonElement => button !== null);

interface PendingOperation {
  id: number;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
}

let pendingOperation: PendingOperation | null = null;
let operationId = 0;
let uiRevision = 0;
let disposed = false;
let language = DEFAULT_LANGUAGE;
let savedLanguage = DEFAULT_LANGUAGE;
let languageWarning = false;
let savingLanguage = false;
let nameEdited = false;
let statusMessage: { key: string; values?: Record<string, string | number> } | null = null;

function setStatus(key: string, values?: Record<string, string | number>): void {
  statusMessage = { key, values };
  if (status && !disposed) status.textContent = translate(language, key, values);
}

function applyLanguage(next: string): void {
  const previousDefaultName = translate(language, 'defaultReviewName');
  const nameIsDefault =
    !nameEdited && (nameInput?.value === previousDefaultName || !nameInput?.value);
  language = next;
  document.documentElement.lang = next;
  document.title = translate(language, 'panelTitle');
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = element.dataset.i18n;
    if (key) element.textContent = translate(language, key);
  }
  if (languageSelect) languageSelect.value = language;
  if (nameInput && nameIsDefault) nameInput.value = translate(language, 'defaultReviewName');
  if (status && statusMessage && !disposed) {
    status.textContent = translate(language, statusMessage.key, statusMessage.values);
  }
}

async function saveLanguage(): Promise<void> {
  if (!languageSelect || savingLanguage || disposed) return;
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
    languageWarning = false;
    setStatus('languageSaved');
  } catch {
    if (disposed) return;
    applyLanguage(previous);
    setStatus('languageSaveFailed');
  } finally {
    savingLanguage = false;
    if (!disposed) languageSelect.disabled = false;
  }
}

async function loadLanguage(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(LANGUAGE_STORAGE_KEY);
    if (disposed) return;
    const locale = resolveLanguage(stored[LANGUAGE_STORAGE_KEY]);
    languageWarning = locale.unsupported;
    savedLanguage = locale.language;
    applyLanguage(locale.language);
    if (locale.unsupported) setStatus('unsupportedLanguage');
  } catch {
    if (!disposed) {
      languageWarning = true;
      applyLanguage(DEFAULT_LANGUAGE);
      setStatus('languageLoadFailed');
    }
  }
}

function setActionButtonsDisabled(disabled: boolean): void {
  for (const button of actionButtons) button.disabled = disabled;
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('cancelled'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error('cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function cancelOperation(message: string): void {
  const operation = pendingOperation;
  if (!operation) return;
  clearTimeout(operation.timer);
  pendingOperation = null;
  operation.controller.abort();
  setActionButtonsDisabled(false);
  if (cancelButton) cancelButton.hidden = true;
  setStatus(message);
}

function baseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

async function runAction(
  type: string,
  successMessage: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (pendingOperation || disposed) return;
  const currentId = ++operationId;
  uiRevision += 1;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    if (pendingOperation?.id === currentId) {
      cancelOperation('timeoutUnconfirmed');
    }
  }, 15_000);
  const operation = { id: currentId, controller, timer };
  pendingOperation = operation;
  setActionButtonsDisabled(true);
  if (cancelButton) cancelButton.hidden = false;
  setStatus('sendingCommand');

  try {
    const pending = Promise.resolve().then(() => chrome.runtime.sendMessage({ type, ...extra }));
    const response = await withAbort(pending, controller.signal);
    if (disposed || pendingOperation !== operation) return;
    if (response?.error) throw new Error('command-failed');
    setStatus(successMessage);
  } catch {
    if (disposed || pendingOperation !== operation) return;
    setStatus('cannotConfirmAction');
  } finally {
    if (pendingOperation === operation) {
      clearTimeout(operation.timer);
      pendingOperation = null;
      setActionButtonsDisabled(false);
      if (cancelButton) cancelButton.hidden = true;
    }
  }
}

async function openHistory(): Promise<void> {
  const revision = ++uiRevision;
  try {
    const stored = await chrome.storage.local.get('apiBaseUrl');
    if (disposed || revision !== uiRevision) return;
    const url = baseUrl(stored.apiBaseUrl);
    if (!url) {
      setStatus('configureValidApi');
      return;
    }
    await chrome.tabs.create({ url });
    if (!disposed && revision === uiRevision) setStatus('historyOpened');
  } catch {
    if (!disposed && revision === uiRevision) setStatus('historyCannotOpen');
  }
}

async function openOptions(): Promise<void> {
  uiRevision += 1;
  try {
    await chrome.runtime.openOptionsPage();
  } catch {
    setStatus('optionsCannotOpen');
  }
}

document.querySelector('#start')?.addEventListener('click', () => {
  void runAction('start', 'recording', { name: nameInput?.value ?? '' });
});
document
  .querySelector('#pause')
  ?.addEventListener('click', () => void runAction('pause', 'paused'));
document
  .querySelector('#resume')
  ?.addEventListener('click', () => void runAction('resume', 'recording'));
document
  .querySelector('#shot')
  ?.addEventListener('click', () => void runAction('screenshot', 'screenshotRequested'));
document
  .querySelector('#stop')
  ?.addEventListener('click', () => void runAction('stop', 'reviewFinished'));
document.querySelector('#history')?.addEventListener('click', () => void openHistory());
document.querySelector('#options')?.addEventListener('click', () => void openOptions());
nameInput?.addEventListener('input', () => {
  nameEdited = true;
});
languageSelect?.addEventListener('change', () => void saveLanguage());
chrome.storage.onChanged?.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[LANGUAGE_STORAGE_KEY] || disposed) return;
  const locale = resolveLanguage(changes[LANGUAGE_STORAGE_KEY].newValue);
  languageWarning = locale.unsupported;
  savedLanguage = locale.language;
  applyLanguage(locale.language);
  if (locale.unsupported) setStatus('unsupportedLanguage');
});
cancelButton?.addEventListener('click', () => {
  cancelOperation('commandSentUnconfirmed');
});

document.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape' && pendingOperation) {
    event.preventDefault();
    cancelOperation('commandSentUnconfirmed');
  }
});

window.addEventListener('pagehide', () => {
  disposed = true;
  if (pendingOperation) {
    clearTimeout(pendingOperation.timer);
    pendingOperation.controller.abort();
    pendingOperation = null;
  }
});

const initialRevision = uiRevision;
void loadLanguage();
void Promise.resolve()
  .then(() => chrome.runtime.sendMessage({ type: 'query-recording' }))
  .then((response) => {
    if (disposed || uiRevision !== initialRevision) return;
    if (!languageWarning) setStatus(response?.recording ? 'recording' : 'ready');
  })
  .catch(() => {
    if (!disposed && uiRevision === initialRevision) {
      setStatus('stateCannotQuery');
    }
  });
