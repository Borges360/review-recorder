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

export interface AdminProvider {
  id: 'openai' | 'openrouter' | 'anthropic';
  label: string;
  capabilities: { transcriptionOffline: boolean; transcriptionRealtime: boolean; text: boolean };
  keyRef: string;
  defaultKeyRef: string;
  keyConfigured: boolean;
  allowedKeyRefs?: string[];
}

export interface AdminTask {
  id: 'transcription_realtime' | 'transcription_offline' | 'session_summary';
  label: string;
  provider: AdminProvider['id'];
  model: string;
  supported: boolean;
  keyConfigured: boolean;
  overridden: boolean;
  providerOptions: AdminProvider['id'][];
  defaultModels: Record<string, string | null>;
  enabled?: boolean;
  /** False when the model has no tariff: its cost is unknown and, with a blocking budget, the call is refused. */
  priced?: boolean;
  effort?: 'low' | 'medium' | 'high' | null;
}

export interface Tariff {
  audioUsdPerMinute?: number;
  inputUsdPerMTok?: number;
  outputUsdPerMTok?: number;
}

export interface AdminLlmView {
  providers: AdminProvider[];
  tasks: AdminTask[];
  budget: { monthlyUsd: number | null; action: 'warn' | 'block'; spentUsd: number; exceeded: boolean };
  tariffs: { version: string; baseVersion: string; entries: Record<string, Tariff & { custom: boolean }> };
  updatedAt: string | null;
}

export interface UsageTotals {
  costUsd: number;
  audioSeconds: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  unpricedCalls: number;
}

export interface AdminUsage {
  month: string;
  totals: UsageTotals;
  byTask: Record<string, UsageTotals>;
  byModel: Record<string, UsageTotals>;
  sessions: Array<UsageTotals & { sessionId: string; name: string | null }>;
}

export interface AdminLlmPatch {
  routes?: Record<string, { provider?: string; model?: string; effort?: 'low' | 'medium' | 'high' | null } | null>;
  keyRefs?: Record<string, string | null>;
  summaryEnabled?: boolean;
  budget?: { monthlyUsd?: number | null; action?: 'warn' | 'block' };
  tariffs?: Record<string, Tariff | null>;
}

const ADMIN_TOKEN_KEY = 'rr-admin-token';

export function getAdminToken(): string {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setAdminToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class AdminAuthError extends Error {}

function apiErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    return parsed.error ?? raw;
  } catch {
    return raw;
  }
}

async function adminRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  const token = getAdminToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  try {
    return await request<T>(`/admin/llm${path}`, { ...options, headers });
  } catch (e) {
    const message = apiErrorMessage(e instanceof Error ? e.message : String(e));
    if (message.startsWith('admin_disabled')) {
      throw new AdminAuthError('Admin desligado neste servidor: defina ADMIN_TOKEN ou API_TOKEN.');
    }
    if (message === 'unauthorized') throw new AdminAuthError('Token de admin necessário.');
    throw new Error(message);
  }
}

export const adminApi = {
  get: () => adminRequest<AdminLlmView>(''),
  update: (patch: AdminLlmPatch) => adminRequest<AdminLlmView>('', { method: 'PUT', body: JSON.stringify(patch) }),
  usage: (month?: string) => adminRequest<AdminUsage>(`/usage${month ? `?month=${encodeURIComponent(month)}` : ''}`),
  test: (provider: string) =>
    adminRequest<{ ok: boolean; status: number | null; message: string }>('/test', {
      method: 'POST',
      body: JSON.stringify({ provider }),
    }),
};

export const api = {
  getConfig: () => request<{ openaiConfigured: boolean; summaryEnabled?: boolean }>('/config'),
  getSessionSummary: (id: string) =>
    request<{ summary: string; provider: string; model: string; costUsd: number | null }>(`/sessions/${id}/summary`),
  createSessionSummary: (id: string) =>
    request<{ summary: string; provider: string; model: string; costUsd: number | null }>(`/sessions/${id}/summary`, {
      method: 'POST',
    }),
  getSessionUsage: (id: string) =>
    request<{ costUsd: number; audioSeconds: number; calls: number; unpricedCalls: number }>(`/sessions/${id}/llm-usage`),
  listSessions: () => request<SessionRecord[]>('/sessions'),
  getSession: (id: string) => request<SessionRecord>(`/sessions/${id}`),
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
