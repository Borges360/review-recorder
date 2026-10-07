const status = document.querySelector('#status');
const nameInput = document.querySelector('#name') as HTMLInputElement;

function setStatus(text: string): void {
  if (status) status.textContent = text;
}

async function send(type: string, extra: Record<string, unknown> = {}): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (response?.error) throw new Error(response.error);
}

document.querySelector('#start')?.addEventListener('click', () => {
  void send('start', { name: nameInput.value }).then(() => setStatus('Gravando')).catch((error: unknown) => setStatus(String(error)));
});
document.querySelector('#pause')?.addEventListener('click', () => {
  void send('pause').then(() => setStatus('Pausada')).catch((error: unknown) => setStatus(String(error)));
});
document.querySelector('#resume')?.addEventListener('click', () => {
  void send('resume').then(() => setStatus('Gravando')).catch((error: unknown) => setStatus(String(error)));
});
document.querySelector('#shot')?.addEventListener('click', () => {
  void send('screenshot').then(() => setStatus('Print enviado')).catch((error: unknown) => setStatus(String(error)));
});
document.querySelector('#stop')?.addEventListener('click', () => {
  void send('stop').then(() => setStatus('Finalizada')).catch((error: unknown) => setStatus(String(error)));
});
document.querySelector('#history')?.addEventListener('click', () => {
  void chrome.storage.local.get('apiBaseUrl').then((stored) => {
    const base = String(stored.apiBaseUrl ?? '').replace(/\/$/, '');
    if (!base) {
      setStatus('Configure a URL da API');
      return;
    }
    void chrome.tabs.create({ url: base });
  });
});
document.querySelector('#options')?.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

void chrome.runtime.sendMessage({ type: 'query-recording' }).then((response) => {
  if (response?.recording) setStatus('Gravando');
});
