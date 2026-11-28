export type ProviderId = 'openai' | 'openrouter' | 'anthropic';
export type TaskId = 'transcription_realtime' | 'transcription_offline' | 'session_summary';

export const PROVIDER_IDS: readonly ProviderId[] = ['openai', 'openrouter', 'anthropic'];
export const TASK_IDS: readonly TaskId[] = ['transcription_realtime', 'transcription_offline', 'session_summary'];

export interface RouteOverride {
  provider?: ProviderId;
  model?: string;
  /** Reasoning effort for text tasks (OpenAI reasoning_effort, OpenRouter reasoning.effort, Anthropic output_config.effort). */
  effort?: 'low' | 'medium' | 'high';
}

export interface Tariff {
  /** USD per minute of audio (speech-to-text). */
  audioUsdPerMinute?: number;
  /** USD per million input tokens (text tasks). */
  inputUsdPerMTok?: number;
  /** USD per million output tokens (text tasks). */
  outputUsdPerMTok?: number;
}

export interface BudgetSettings {
  /** Monthly estimated spend ceiling in USD. null = no ceiling. */
  monthlyUsd: number | null;
  action: 'warn' | 'block';
}

/**
 * What the admin persists. Everything is an override: an empty object means "behave
 * exactly like the environment-only setup". API keys are never stored, only the NAME of
 * the environment variable that holds each key.
 */
export interface StoredLlmSettings {
  routes: Partial<Record<TaskId, RouteOverride>>;
  keyRefs: Partial<Record<ProviderId, string>>;
  summaryEnabled: boolean;
  budget: BudgetSettings;
  /** Tariff overrides keyed by `provider/model`. */
  tariffs: Record<string, Tariff>;
  /** Incremented every time the tariff overrides change. 0 = built-in table only. */
  tariffRevision: number;
  updatedAt: string | null;
}

export interface ResolvedRoute {
  task: TaskId;
  provider: ProviderId;
  model: string;
  baseUrl: string;
  keyRef: string;
  apiKey: string | null;
  /** Reasoning effort for text tasks; undefined = provider default (nothing sent). */
  effort?: 'low' | 'medium' | 'high';
  /** False when the provider cannot perform this task (for example Anthropic has no STT). */
  supported: boolean;
  /** Named configuration error (e.g. TRANSCRIPTION_PROVIDER missing); the task is unavailable while set. */
  error?: string;
}

export interface UsageRecord {
  id: string;
  at: string;
  sessionId: string | null;
  task: TaskId;
  provider: ProviderId;
  model: string;
  audioSeconds: number;
  inputTokens: number;
  outputTokens: number;
  /** null when no tariff covers provider/model. */
  costUsd: number | null;
  tariffVersion: string;
  ok: boolean;
}

export interface AuditRecord {
  at: string;
  action: string;
  /** Names of the changed fields only; values of keys never appear here. */
  changes: string[];
}

export function emptySettings(): StoredLlmSettings {
  return {
    routes: {},
    keyRefs: {},
    summaryEnabled: false,
    budget: { monthlyUsd: null, action: 'warn' },
    tariffs: {},
    tariffRevision: 0,
    updatedAt: null,
  };
}
