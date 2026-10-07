const baseInput = document.querySelector('#base') as HTMLInputElement;
const tokenInput = document.querySelector('#token') as HTMLInputElement;
const result = document.querySelector('#result');

function show(text: string): void {
  if (result) result.textContent = text;
}

async function load(): Promise<void> {
  const stored = await chrome.storage.local.get(['apiBaseUrl', 'apiToken']);
  baseInput.value = String(stored.apiBaseUrl ?? 'https://review.luizfelipeborges.dev');
  tokenInput.value = String(stored.apiToken ?? '');
}

document.querySelector('#save')?.addEventListener('click', () => {
  void chrome.storage.local
    .set({ apiBaseUrl: baseInput.value.trim(), apiToken: tokenInput.value.trim() })
    .then(() => show('Salvo'));
});

document.querySelector('#test')?.addEventListener('click', () => {
  const base = baseInput.value.trim().replace(/\/$/, '');
  const headers = new Headers();
  if (tokenInput.value.trim()) headers.set('Authorization', `Bearer ${tokenInput.value.trim()}`);
  void fetch(`${base}/sessions?limit=1`, { headers })
    .then((response) => {
      show(response.ok ? 'API acessível' : `Falhou (${response.status})`);
    })
    .catch((error: unknown) => show(String(error)));
});

void load();
