import { enqueue, flushOutbox, readSettings, type OutboxItem } from './outbox.js';

interface RecordingState {
  id: string | null;
  recording: boolean;
  paused: boolean;
  startedAt: number;
  pausedAccum: number;
  pausedAt: number;
  chunkMark: number;
}

const state: RecordingState = {
  id: null,
  recording: false,
  paused: false,
  startedAt: 0,
  pausedAccum: 0,
  pausedAt: 0,
  chunkMark: 0,
};

function activeMs(): number {
  const now = Date.now();
  const extra = state.pausedAt ? now - state.pausedAt : 0;
  return Math.max(0, now - state.startedAt - state.pausedAccum - extra);
}

function clientId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const settings = await readSettings();
  if (!settings.apiBaseUrl) throw new Error('Configure a URL da API nas opções da extensão');
  const headers = new Headers(init.headers);
  if (settings.apiToken) headers.set('Authorization', `Bearer ${settings.apiToken}`);
  if (init.body && !(init.body instanceof Blob) && typeof init.body === 'string') {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(`${settings.apiBaseUrl.replace(/\/$/, '')}${path}`, { ...init, headers });
  if (!response.ok) throw new Error(await response.text());
  return response;
}

async function ensureOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Gravar o microfone da revisão enquanto a aba navega',
  });
}

async function ensureMic(): Promise<void> {
  const stored = await chrome.storage.local.get('micGranted');
  if (stored.micGranted) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error('Permissão do microfone não concedida'));
    }, 60000);
    const listener = (message: { type?: string }) => {
      if (message.type !== 'mic-granted') return;
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(listener);
      resolve();
    };
    chrome.runtime.onMessage.addListener(listener);
    void chrome.tabs.create({ url: chrome.runtime.getURL('request-mic.html'), active: true });
  });
  await chrome.storage.local.set({ micGranted: true });
}

async function broadcastRecording(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      await chrome.tabs.sendMessage(tab.id, { type: 'recording', value: state.recording && !state.paused }).catch(() => {});
    }),
  );
}

async function start(name: string): Promise<RecordingState> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const created = await api('/sessions', {
    method: 'POST',
    body: JSON.stringify({
      name: name.trim() || 'Revisão',
      capture: 'extension',
      initialUrl: tab?.url,
    }),
  });
  const session = (await created.json()) as { id: string };
  await api(`/sessions/${session.id}/start`, { method: 'POST' });
  state.id = session.id;
  state.recording = true;
  state.paused = false;
  state.startedAt = Date.now();
  state.pausedAccum = 0;
  state.pausedAt = 0;
  state.chunkMark = 0;
  await chrome.storage.session.set({ sessionId: session.id });
  await chrome.action.setBadgeText({ text: 'REC' });
  await ensureMic();
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ type: 'mic-start' }).catch(() => {});
  await broadcastRecording();
  if (tab?.id !== undefined) {
    await chrome.tabs.sendMessage(tab.id, { type: 'collect-screen', url: tab.url }).catch(() => {});
  }
  return state;
}

async function pause(): Promise<void> {
  if (!state.id) return;
  await api(`/sessions/${state.id}/pause`, { method: 'POST' });
  state.paused = true;
  state.pausedAt = Date.now();
  await chrome.runtime.sendMessage({ type: 'mic-stop' }).catch(() => {});
  await chrome.action.setBadgeText({ text: 'PAUSA' });
  await broadcastRecording();
}

async function resume(): Promise<void> {
  if (!state.id) return;
  await api(`/sessions/${state.id}/resume`, { method: 'POST' });
  if (state.pausedAt) state.pausedAccum += Date.now() - state.pausedAt;
  state.pausedAt = 0;
  state.paused = false;
  state.chunkMark = activeMs();
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ type: 'mic-start' }).catch(() => {});
  await chrome.action.setBadgeText({ text: 'REC' });
  await broadcastRecording();
}

async function stop(): Promise<void> {
  if (!state.id) return;
  await chrome.runtime.sendMessage({ type: 'mic-stop' }).catch(() => {});
  await flushOutbox();
  const id = state.id;
  state.recording = false;
  state.paused = false;
  await broadcastRecording();
  await api(`/sessions/${id}/stop`, { method: 'POST' });
  state.id = null;
  await chrome.action.setBadgeText({ text: '' });
}

async function queue(item: OutboxItem): Promise<void> {
  await enqueue(item);
  await flushOutbox();
}

async function onEvents(events: Array<Record<string, unknown>>): Promise<void> {
  if (!state.id || !state.recording || state.paused) return;
  const elapsed = activeMs();
  const stamped = events.map((event) => ({
    ...event,
    activeElapsedMs: elapsed,
    elapsedMs: elapsed,
  }));
  await queue({
    id: clientId('batch'),
    kind: 'events',
    path: `/sessions/${state.id}/events`,
    headers: {},
    json: { events: stamped },
    attempts: 0,
  });
}

async function onAudio(blob: Blob): Promise<void> {
  if (!state.id || !state.recording || state.paused) return;
  const end = activeMs();
  const start = state.chunkMark;
  state.chunkMark = end;
  const id = clientId('chunk');
  await queue({
    id,
    kind: 'audio',
    path: `/sessions/${state.id}/audio`,
    headers: {
      'content-type': 'application/octet-stream',
      'x-client-id': id,
      'x-chunk-start-ms': String(start),
      'x-chunk-duration-ms': String(Math.max(end - start, 1)),
    },
    blob,
    attempts: 0,
  });
}

async function screenshot(): Promise<void> {
  if (!state.id || !state.recording) throw new Error('Nenhuma revisão gravando');
  const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const id = clientId('shot');
  const elapsed = activeMs();
  await queue({
    id,
    kind: 'screenshot',
    path: `/sessions/${state.id}/screenshot`,
    headers: {
      'content-type': 'application/octet-stream',
      'x-client-id': id,
      'x-elapsed-ms': String(elapsed),
      'x-active-elapsed-ms': String(elapsed),
    },
    blob,
    attempts: 0,
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void chrome.alarms.create('flush-outbox', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flush-outbox') void flushOutbox();
});

chrome.action.onClicked.addListener(() => {
  void chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
});

function watchNavigation(details: { tabId: number; frameId: number; url: string }): void {
  if (!state.recording || state.paused || details.frameId !== 0) return;
  void chrome.tabs.sendMessage(details.tabId, { type: 'collect-screen', url: details.url }).catch(() => {});
  void onEvents([
    {
      clientId: clientId('nav'),
      type: 'navigation',
      activeElapsedMs: activeMs(),
      elapsedMs: activeMs(),
      url: details.url,
      payload: { kind: 'load' },
    },
  ]);
}

chrome.webNavigation.onCompleted.addListener(watchNavigation);
chrome.webNavigation.onHistoryStateUpdated.addListener(watchNavigation);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    switch (message.type) {
      case 'query-recording':
        return { recording: state.recording && !state.paused, sessionId: state.id };
      case 'start':
        return start(String(message.name ?? 'Revisão'));
      case 'pause':
        await pause();
        return { ok: true };
      case 'resume':
        await resume();
        return { ok: true };
      case 'stop':
        await stop();
        return { ok: true };
      case 'screenshot':
        await screenshot();
        return { ok: true };
      case 'events':
        await onEvents(message.events ?? []);
        return { ok: true };
      case 'audio-chunk':
        await onAudio(message.blob as Blob);
        return { ok: true };
      case 'settings':
        return readSettings();
      default:
        return { ok: true };
    }
  };
  void run().then(sendResponse).catch((error: unknown) => sendResponse({ error: String(error) }));
  return true;
});
