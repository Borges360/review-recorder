import { nextRetryDelayMs } from './retry.js';

export interface StoredSettings {
  apiBaseUrl: string;
  apiToken: string;
}

export interface OutboxItem {
  id: string;
  kind: 'events' | 'audio' | 'screenshot';
  path: string;
  headers: Record<string, string>;
  json?: unknown;
  blob?: Blob;
  attempts: number;
}

const DB_NAME = 'review-recorder';
const STORE = 'outbox';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function enqueue(item: OutboxItem): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const db = await openDb();
  const items = await new Promise<OutboxItem[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as OutboxItem[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return items;
}

export async function removeOutbox(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function bumpAttempt(item: OutboxItem): Promise<void> {
  await enqueue({ ...item, attempts: item.attempts + 1 });
}

export async function readSettings(): Promise<StoredSettings> {
  const stored = await chrome.storage.local.get(['apiBaseUrl', 'apiToken']);
  return {
    apiBaseUrl: String(stored.apiBaseUrl ?? ''),
    apiToken: String(stored.apiToken ?? ''),
  };
}

export async function postItem(settings: StoredSettings, item: OutboxItem): Promise<boolean> {
  if (!settings.apiBaseUrl) return false;
  const headers = new Headers(item.headers);
  if (settings.apiToken) headers.set('Authorization', `Bearer ${settings.apiToken}`);
  const body = item.blob ?? JSON.stringify(item.json ?? {});
  if (!item.blob) headers.set('content-type', 'application/json');
  const response = await fetch(`${settings.apiBaseUrl.replace(/\/$/, '')}${item.path}`, {
    method: 'POST',
    headers,
    body,
  });
  if (response.status === 401) return false;
  return response.ok;
}

export async function flushOutbox(): Promise<void> {
  const settings = await readSettings();
  const items = await listOutbox();
  for (const item of items) {
    try {
      const ok = await postItem(settings, item);
      if (ok) await removeOutbox(item.id);
      else {
        await bumpAttempt(item);
        await delay(nextRetryDelayMs(item.attempts));
      }
    } catch {
      await bumpAttempt(item);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
