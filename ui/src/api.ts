const API_BASE = '/api';

export interface SessionRecord {
  id: string;
  name: string;
  slug: string;
  initialUrl: string | null;
  description?: string | null;
  status: string;
  createdAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
  outputDir: string | null;
  wallElapsedMs: number;
  activeElapsedMs: number;
}

export interface TimelineEntry {
  id: string;
  offset: string;
  type: string;
  [key: string]: unknown;
}

export interface ReviewPackage {
  schemaVersion: string;
  session: {
    id: string;
    name: string;
    startedAt: string;
    stoppedAt: string | null;
    activeDurationSeconds: number;
    wallDurationSeconds: number;
  };
  timeline: TimelineEntry[];
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body != null && options.body !== '' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getConfig: () => request<{ openaiConfigured: boolean }>('/config'),
  listSessions: () => request<SessionRecord[]>('/sessions'),
  createSession: (name: string, initialUrl?: string, description?: string) =>
    request<SessionRecord>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ name, initialUrl, description }),
    }),
  startSession: (id: string) => request<SessionRecord>(`/sessions/${id}/start`, { method: 'POST' }),
  pauseSession: (id: string) => request<SessionRecord>(`/sessions/${id}/pause`, { method: 'POST' }),
  resumeSession: (id: string) => request<SessionRecord>(`/sessions/${id}/resume`, { method: 'POST' }),
  screenshotSession: (id: string) =>
    request<unknown>(`/sessions/${id}/screenshot`, { method: 'POST' }),
  stopSession: (id: string) => request<SessionRecord>(`/sessions/${id}/stop`, { method: 'POST' }),
  reopenBrowser: (id: string) =>
    request<{ ok: boolean }>(`/sessions/${id}/reopen-browser`, { method: 'POST' }),
  finalizeSession: (id: string) =>
    request<SessionRecord>(`/sessions/${id}/finalize`, { method: 'POST' }),
  getTimeline: (id: string) =>
    request<{ sessionId: string; timeline: TimelineEntry[] }>(`/sessions/${id}/timeline`),
  exportSession: (id: string) =>
    request<{ reviewMd: string; reviewJson: ReviewPackage | null; outputDir: string }>(
      `/sessions/${id}/export`,
    ),
};

export function eventsWsUrl(sessionId: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws/sessions/${sessionId}/events`;
}

export function audioWsUrl(sessionId: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws/sessions/${sessionId}/audio`;
}

export function formatTimer(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
