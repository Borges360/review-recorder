import type { ProviderId, TaskId } from './types.js';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  defaultKeyRef: string;
  capabilities: {
    transcriptionOffline: boolean;
    transcriptionRealtime: boolean;
    text: boolean;
  };
  defaultBaseUrl: string;
  defaultModels: { transcriptionOffline?: string; transcriptionRealtime?: string; text?: string };
}

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultKeyRef: 'OPENAI_API_KEY',
    capabilities: { transcriptionOffline: true, transcriptionRealtime: true, text: true },
    defaultBaseUrl: OPENAI_BASE_URL,
    defaultModels: {
      transcriptionOffline: 'gpt-4o-transcribe',
      transcriptionRealtime: 'gpt-live-transcribe',
      text: 'gpt-4o-mini',
    },
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultKeyRef: 'OPENROUTER_API_KEY',
    // OpenRouter has no realtime transcription socket: offline/chunked only.
    capabilities: { transcriptionOffline: true, transcriptionRealtime: false, text: true },
    defaultBaseUrl: OPENROUTER_BASE_URL,
    defaultModels: { transcriptionOffline: 'openai/gpt-4o-transcribe', text: 'openai/gpt-4o-mini' },
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    defaultKeyRef: 'ANTHROPIC_API_KEY',
    // Anthropic offers no speech-to-text. Declared explicitly so nothing pretends otherwise.
    capabilities: { transcriptionOffline: false, transcriptionRealtime: false, text: true },
    defaultBaseUrl: ANTHROPIC_BASE_URL,
    defaultModels: { text: 'claude-haiku-5-5' },
  },
};

export const TASK_LABELS: Record<TaskId, string> = {
  transcription_realtime: 'Transcrição em tempo real',
  transcription_offline: 'Transcrição offline (chunks e recuperação)',
  session_summary: 'Resumo da timeline da sessão (opcional)',
};

export function providerSupportsTask(provider: ProviderId, task: TaskId): boolean {
  const caps = PROVIDERS[provider].capabilities;
  if (task === 'transcription_realtime') return caps.transcriptionRealtime;
  if (task === 'transcription_offline') return caps.transcriptionOffline;
  return caps.text;
}

export function providersForTask(task: TaskId): ProviderId[] {
  return (Object.keys(PROVIDERS) as ProviderId[]).filter((p) => providerSupportsTask(p, task));
}

export function defaultModelFor(provider: ProviderId, task: TaskId): string | null {
  const models = PROVIDERS[provider].defaultModels;
  if (task === 'transcription_realtime') return models.transcriptionRealtime ?? null;
  if (task === 'transcription_offline') return models.transcriptionOffline ?? null;
  return models.text ?? null;
}

/**
 * Key references are restricted per provider: the provider's own default variable, plus names the
 * operator pre-declares in the environment (LLM_KEY_REFS_OPENAI, LLM_KEY_REFS_OPENROUTER,
 * LLM_KEY_REFS_ANTHROPIC, comma-separated). A generic *_API_KEY pattern would let an admin send
 * another service's key to the provider host, so the admin can only pick from this allowlist.
 */
const KEY_REF_RE = /^[A-Z][A-Z0-9_]{0,62}_API_KEY$/;

export function allowedKeyRefs(provider: ProviderId, env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env[`LLM_KEY_REFS_${provider.toUpperCase()}`] ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => KEY_REF_RE.test(v));
  return [...new Set([PROVIDERS[provider].defaultKeyRef, ...extra])];
}

export function isValidKeyRef(provider: ProviderId, value: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return KEY_REF_RE.test(value) && allowedKeyRefs(provider, env).includes(value);
}

export const EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

export function isValidModel(value: string): boolean {
  return MODEL_RE.test(value);
}
