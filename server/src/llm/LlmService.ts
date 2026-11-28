import { randomUUID } from 'node:crypto';
import { resolveTranscriptionConfig, secureBaseUrl } from '../voice/transcriptionProvider.js';
import { MemoryLlmPersistence, type LlmPersistence } from './persistence.js';
import {
  PROVIDERS,
  TASK_LABELS,
  defaultModelFor,
  isValidKeyRef,
  isValidModel,
  providerSupportsTask,
  providersForTask,
} from './providers.js';
import { DEFAULT_TARIFFS, DEFAULT_TARIFF_VERSION, estimateCostUsd, findTariff, tariffVersionLabel } from './pricing.js';
import {
  SUMMARY_SYSTEM_PROMPT,
  completeText,
  timelineToPrompt,
  type FetchLike,
} from './textTask.js';
import {
  PROVIDER_IDS,
  TASK_IDS,
  emptySettings,
  type AuditRecord,
  type ProviderId,
  type ResolvedRoute,
  type StoredLlmSettings,
  type TaskId,
  type Tariff,
  type UsageRecord,
} from './types.js';

export class LlmValidationError extends Error {}

export type LlmErrorCode =
  | 'summary_disabled'
  | 'provider_unsupported'
  | 'no_api_key'
  | 'budget_exceeded'
  | 'upstream_error';

export class LlmTaskError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface SettingsPatch {
  routes?: Partial<Record<TaskId, { provider?: ProviderId; model?: string } | null>>;
  keyRefs?: Partial<Record<ProviderId, string | null>>;
  summaryEnabled?: boolean;
  budget?: { monthlyUsd?: number | null; action?: 'warn' | 'block' };
  tariffs?: Record<string, Tariff | null>;
}

export interface UsageUsedInput {
  sessionId: string | null;
  task: TaskId;
  provider: ProviderId;
  model: string;
  audioSeconds?: number;
  inputTokens?: number;
  outputTokens?: number;
  ok?: boolean;
}

export interface BudgetStatus {
  monthlyUsd: number | null;
  action: 'warn' | 'block';
  spentUsd: number;
  exceeded: boolean;
}

export interface LlmServiceOptions {
  persistence?: LlmPersistence;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export interface UsageTotals {
  costUsd: number;
  audioSeconds: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  /** Calls whose provider/model has no tariff (cost unknown, not counted in costUsd). */
  unpricedCalls: number;
}

function zeroTotals(): UsageTotals {
  return { costUsd: 0, audioSeconds: 0, inputTokens: 0, outputTokens: 0, calls: 0, unpricedCalls: 0 };
}

function addTo(totals: UsageTotals, r: UsageRecord): void {
  totals.costUsd = Math.round((totals.costUsd + (r.costUsd ?? 0)) * 1e6) / 1e6;
  totals.audioSeconds += r.audioSeconds;
  totals.inputTokens += r.inputTokens;
  totals.outputTokens += r.outputTokens;
  totals.calls += 1;
  if (r.costUsd === null) totals.unpricedCalls += 1;
}

export function monthBounds(month: string): { start: Date; end: Date } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new LlmValidationError('month must be YYYY-MM');
  const year = Number(m[1]);
  const idx = Number(m[2]) - 1;
  return { start: new Date(Date.UTC(year, idx, 1)), end: new Date(Date.UTC(year, idx + 1, 1)) };
}

function utcMonth(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/**
 * Admin-controlled provider/model routing per task, usage + estimated cost and an optional
 * monthly budget. Keys come from the environment only; settings hold the variable NAME.
 */
export class LlmService {
  private settings: StoredLlmSettings;
  private readonly persistence: LlmPersistence;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;

  private constructor(settings: StoredLlmSettings, opts: Required<Omit<LlmServiceOptions, 'persistence'>> & { persistence: LlmPersistence }) {
    this.settings = settings;
    this.persistence = opts.persistence;
    this.env = opts.env;
    this.fetchImpl = opts.fetchImpl;
    this.now = opts.now;
  }

  static async create(options: LlmServiceOptions = {}): Promise<LlmService> {
    const persistence = options.persistence ?? new MemoryLlmPersistence();
    let stored: StoredLlmSettings | null = null;
    try {
      stored = await persistence.loadSettings();
    } catch (error) {
      console.warn(`LLM settings could not be loaded, using defaults: ${String(error)}`);
    }
    return new LlmService(stored ?? emptySettings(), {
      persistence,
      env: options.env ?? process.env,
      fetchImpl: options.fetchImpl ?? ((...args) => fetch(...args)),
      now: options.now ?? (() => new Date()),
    });
  }

  /** Synchronous, environment-only service (no stored overrides): today's behaviour, used when none is injected. */
  static envOnly(options: LlmServiceOptions = {}): LlmService {
    return new LlmService(emptySettings(), {
      persistence: options.persistence ?? new MemoryLlmPersistence(),
      env: options.env ?? process.env,
      fetchImpl: options.fetchImpl ?? ((...args) => fetch(...args)),
      now: options.now ?? (() => new Date()),
    });
  }

  getSettings(): StoredLlmSettings {
    return structuredClone(this.settings);
  }

  // ---- resolution -------------------------------------------------------------------

  keyRef(provider: ProviderId): string {
    return this.settings.keyRefs[provider] ?? PROVIDERS[provider].defaultKeyRef;
  }

  keyConfigured(provider: ProviderId): boolean {
    return Boolean(this.env[this.keyRef(provider)]?.trim());
  }

  private baseUrl(provider: ProviderId): string {
    if (provider === 'openrouter') return secureBaseUrl(this.env.OPENROUTER_BASE_URL, PROVIDERS.openrouter.defaultBaseUrl);
    return PROVIDERS[provider].defaultBaseUrl;
  }

  /** Environment-only default route for a task: today's behaviour when nothing is configured. */
  private envDefault(task: TaskId): { provider: ProviderId; model: string | null } {
    if (task === 'transcription_realtime') return { provider: 'openai', model: null };
    if (task === 'transcription_offline') {
      const env = resolveTranscriptionConfig(this.env);
      return { provider: env.provider, model: env.model };
    }
    return { provider: 'openai', model: null };
  }

  resolve(task: TaskId): ResolvedRoute {
    const base = this.envDefault(task);
    const override = this.settings.routes[task] ?? {};
    const provider = override.provider ?? base.provider;
    const fallbackModel = provider === base.provider && base.model ? base.model : defaultModelFor(provider, task);
    const model = override.model ?? fallbackModel ?? '';
    const keyRef = this.keyRef(provider);
    return {
      task,
      provider,
      model,
      baseUrl: this.baseUrl(provider),
      keyRef,
      apiKey: this.env[keyRef]?.trim() || null,
      supported: providerSupportsTask(provider, task) && model !== '',
    };
  }

  summaryEnabled(): boolean {
    return this.settings.summaryEnabled;
  }

  // ---- settings ---------------------------------------------------------------------

  async update(patch: SettingsPatch): Promise<StoredLlmSettings> {
    const next = structuredClone(this.settings);
    const changes: string[] = [];

    for (const [task, value] of Object.entries(patch.routes ?? {})) {
      if (!TASK_IDS.includes(task as TaskId)) throw new LlmValidationError(`unknown task: ${task}`);
      const taskId = task as TaskId;
      if (value === null) {
        delete next.routes[taskId];
        changes.push(`routes.${task}`);
        continue;
      }
      if (typeof value !== 'object' || value === undefined) throw new LlmValidationError(`invalid route for ${task}`);
      const prev = next.routes[taskId] ?? {};
      const route = { ...prev };
      if (value.provider !== undefined) {
        if (!PROVIDER_IDS.includes(value.provider)) throw new LlmValidationError(`unknown provider: ${String(value.provider)}`);
        if (!providerSupportsTask(value.provider, taskId)) {
          const reason =
            value.provider === 'anthropic'
              ? 'Anthropic não oferece transcrição de áudio (sem STT)'
              : `${PROVIDERS[value.provider].label} não suporta ${TASK_LABELS[taskId]}`;
          throw new LlmValidationError(reason);
        }
        if (value.provider !== prev.provider && value.model === undefined) delete route.model;
        route.provider = value.provider;
      }
      if (value.model !== undefined) {
        if (typeof value.model !== 'string' || !isValidModel(value.model)) throw new LlmValidationError('invalid model name');
        route.model = value.model;
      }
      next.routes[taskId] = route;
      changes.push(`routes.${task}`);
    }

    for (const [provider, ref] of Object.entries(patch.keyRefs ?? {})) {
      if (!PROVIDER_IDS.includes(provider as ProviderId)) throw new LlmValidationError(`unknown provider: ${provider}`);
      if (ref === null || ref === undefined || ref === '') {
        delete next.keyRefs[provider as ProviderId];
      } else {
        if (typeof ref !== 'string' || !isValidKeyRef(ref)) {
          throw new LlmValidationError('keyRef must be the NAME of an environment variable ending in _API_KEY');
        }
        next.keyRefs[provider as ProviderId] = ref;
      }
      changes.push(`keyRefs.${provider}`);
    }

    if (patch.summaryEnabled !== undefined) {
      if (typeof patch.summaryEnabled !== 'boolean') throw new LlmValidationError('summaryEnabled must be boolean');
      next.summaryEnabled = patch.summaryEnabled;
      changes.push('summaryEnabled');
    }

    if (patch.budget) {
      const { monthlyUsd, action } = patch.budget;
      if (monthlyUsd !== undefined) {
        if (monthlyUsd !== null && (typeof monthlyUsd !== 'number' || !Number.isFinite(monthlyUsd) || monthlyUsd < 0 || monthlyUsd > 1_000_000)) {
          throw new LlmValidationError('budget.monthlyUsd must be a non-negative number or null');
        }
        next.budget.monthlyUsd = monthlyUsd;
      }
      if (action !== undefined) {
        if (action !== 'warn' && action !== 'block') throw new LlmValidationError('budget.action must be warn or block');
        next.budget.action = action;
      }
      changes.push('budget');
    }

    if (patch.tariffs) {
      for (const [key, tariff] of Object.entries(patch.tariffs)) {
        const slash = key.indexOf('/');
        const provider = key.slice(0, slash);
        const model = key.slice(slash + 1);
        if (slash < 1 || !PROVIDER_IDS.includes(provider as ProviderId) || !isValidModel(model)) {
          throw new LlmValidationError(`invalid tariff key: ${key}`);
        }
        if (tariff === null) {
          delete next.tariffs[key];
        } else {
          const clean: Tariff = {};
          for (const field of ['audioUsdPerMinute', 'inputUsdPerMTok', 'outputUsdPerMTok'] as const) {
            const v = tariff[field];
            if (v === undefined) continue;
            if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100_000) {
              throw new LlmValidationError(`tariff ${key}.${field} must be a non-negative number`);
            }
            clean[field] = v;
          }
          if (Object.keys(clean).length === 0) throw new LlmValidationError(`tariff ${key} has no price`);
          next.tariffs[key] = clean;
        }
        changes.push(`tariffs.${key}`);
      }
      next.tariffRevision += 1;
    }

    if (changes.length === 0) return this.getSettings();

    next.updatedAt = this.now().toISOString();
    await this.persistence.saveSettings(next);
    this.settings = next;
    const audit: AuditRecord = { at: next.updatedAt, action: 'settings.update', changes };
    await this.persistence.appendAudit(audit).catch((e) => console.warn(`LLM audit write failed: ${String(e)}`));
    return this.getSettings();
  }

  async audit(limit = 50): Promise<AuditRecord[]> {
    return this.persistence.listAudit(Math.min(Math.max(limit, 1), 500));
  }

  // ---- usage, cost, budget ----------------------------------------------------------

  async recordUsage(input: UsageUsedInput): Promise<UsageRecord> {
    const usage = {
      audioSeconds: Math.max(0, input.audioSeconds ?? 0),
      inputTokens: Math.max(0, Math.round(input.inputTokens ?? 0)),
      outputTokens: Math.max(0, Math.round(input.outputTokens ?? 0)),
    };
    const tariff = findTariff(this.settings.tariffs, input.provider, input.model);
    const record: UsageRecord = {
      id: randomUUID(),
      at: this.now().toISOString(),
      sessionId: input.sessionId,
      task: input.task,
      provider: input.provider,
      model: input.model,
      ...usage,
      costUsd: estimateCostUsd(tariff, usage),
      tariffVersion: tariffVersionLabel(this.settings.tariffRevision),
      ok: input.ok ?? true,
    };
    await this.persistence.appendUsage(record).catch((e) => console.warn(`LLM usage write failed: ${String(e)}`));
    return record;
  }

  private async monthRecords(month: string): Promise<UsageRecord[]> {
    const { start, end } = monthBounds(month);
    const rows = await this.persistence.listUsage(start.toISOString());
    return rows.filter((r) => r.at < end.toISOString());
  }

  async budgetStatus(): Promise<BudgetStatus> {
    const { monthlyUsd, action } = this.settings.budget;
    const rows = await this.monthRecords(utcMonth(this.now()));
    const spentUsd = Math.round(rows.reduce((sum, r) => sum + (r.costUsd ?? 0), 0) * 1e6) / 1e6;
    return { monthlyUsd, action, spentUsd, exceeded: monthlyUsd !== null && spentUsd >= monthlyUsd };
  }

  /** True when a new billable call may proceed (budget off, under the ceiling, or warn-only). */
  async allowSpend(): Promise<{ allowed: boolean; status: BudgetStatus }> {
    const status = await this.budgetStatus();
    return { allowed: !(status.exceeded && status.action === 'block'), status };
  }

  async usageReport(month: string = utcMonth(this.now())) {
    const rows = await this.monthRecords(month);
    const totals = zeroTotals();
    const byTask: Record<string, UsageTotals> = {};
    const byModel: Record<string, UsageTotals> = {};
    const bySession = new Map<string, UsageTotals>();
    for (const r of rows) {
      addTo(totals, r);
      addTo((byTask[r.task] ??= zeroTotals()), r);
      addTo((byModel[`${r.provider}/${r.model}`] ??= zeroTotals()), r);
      if (r.sessionId) addTo(bySession.get(r.sessionId) ?? bySession.set(r.sessionId, zeroTotals()).get(r.sessionId)!, r);
    }
    const sessions = [...bySession.entries()]
      .map(([sessionId, t]) => ({ sessionId, ...t }))
      .sort((a, b) => b.costUsd - a.costUsd);
    return { month, totals, byTask, byModel, sessions };
  }

  async sessionUsage(sessionId: string): Promise<UsageTotals & { records: UsageRecord[] }> {
    const all = await this.persistence.listUsage();
    const records = all.filter((r) => r.sessionId === sessionId);
    const totals = zeroTotals();
    for (const r of records) addTo(totals, r);
    return { ...totals, records };
  }

  // ---- connection test --------------------------------------------------------------

  async testConnection(provider: ProviderId): Promise<{ ok: boolean; status: number | null; message: string }> {
    if (!PROVIDER_IDS.includes(provider)) throw new LlmValidationError(`unknown provider: ${String(provider)}`);
    const ref = this.keyRef(provider);
    const key = this.env[ref]?.trim();
    if (!key) return { ok: false, status: null, message: `Variável ${ref} não está configurada no ambiente` };
    const base = this.baseUrl(provider).replace(/\/+$/, '');
    const request: { url: string; headers: Record<string, string> } =
      provider === 'anthropic'
        ? { url: `${base}/models?limit=1`, headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } }
        : provider === 'openrouter'
          ? { url: `${base}/key`, headers: { Authorization: `Bearer ${key}` } }
          : { url: `${base}/models`, headers: { Authorization: `Bearer ${key}` } };
    try {
      const res = await this.fetchImpl(request.url, { method: 'GET', headers: request.headers });
      return res.ok
        ? { ok: true, status: res.status, message: 'Conexão válida' }
        : { ok: false, status: res.status, message: `O provedor recusou a chave (HTTP ${res.status})` };
    } catch {
      return { ok: false, status: null, message: 'Falha de rede ao contatar o provedor' };
    }
  }

  // ---- optional text task -----------------------------------------------------------

  async summarizeTimeline(
    sessionId: string,
    timeline: Array<Record<string, unknown>>,
  ): Promise<{ summary: string; provider: ProviderId; model: string; costUsd: number | null }> {
    if (!this.settings.summaryEnabled) {
      throw new LlmTaskError('summary_disabled', 'O resumo da sessão está desabilitado no painel admin');
    }
    const route = this.resolve('session_summary');
    if (!route.supported) throw new LlmTaskError('provider_unsupported', 'Provedor sem suporte a tarefas de texto');
    if (!route.apiKey) throw new LlmTaskError('no_api_key', `Variável ${route.keyRef} não está configurada`);
    const spend = await this.allowSpend();
    if (!spend.allowed) throw new LlmTaskError('budget_exceeded', 'Orçamento mensal esgotado');

    try {
      const result = await completeText(
        route,
        { system: SUMMARY_SYSTEM_PROMPT, user: timelineToPrompt(timeline), maxTokens: 1500 },
        this.fetchImpl,
      );
      const usage = await this.recordUsage({
        sessionId,
        task: 'session_summary',
        provider: route.provider,
        model: route.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
      return { summary: result.text.trim(), provider: route.provider, model: route.model, costUsd: usage.costUsd };
    } catch (error) {
      await this.recordUsage({ sessionId, task: 'session_summary', provider: route.provider, model: route.model, ok: false });
      throw new LlmTaskError('upstream_error', error instanceof Error ? error.message : String(error));
    }
  }

  // ---- admin view (never contains key values) ---------------------------------------

  async view() {
    const budget = await this.budgetStatus();
    const tariffs: Record<string, Tariff & { custom: boolean }> = {};
    for (const [key, t] of Object.entries(DEFAULT_TARIFFS)) tariffs[key] = { ...t, custom: false };
    for (const [key, t] of Object.entries(this.settings.tariffs)) tariffs[key] = { ...t, custom: true };
    return {
      providers: PROVIDER_IDS.map((id) => ({
        id,
        label: PROVIDERS[id].label,
        capabilities: PROVIDERS[id].capabilities,
        keyRef: this.keyRef(id),
        defaultKeyRef: PROVIDERS[id].defaultKeyRef,
        keyConfigured: this.keyConfigured(id),
      })),
      tasks: TASK_IDS.map((task) => {
        const route = this.resolve(task);
        return {
          id: task,
          label: TASK_LABELS[task],
          provider: route.provider,
          model: route.model,
          supported: route.supported,
          keyConfigured: Boolean(route.apiKey),
          overridden: Boolean(this.settings.routes[task]),
          providerOptions: providersForTask(task),
          defaultModels: Object.fromEntries(providersForTask(task).map((p) => [p, defaultModelFor(p, task)])),
          ...(task === 'session_summary' ? { enabled: this.settings.summaryEnabled } : {}),
        };
      }),
      budget,
      tariffs: { version: tariffVersionLabel(this.settings.tariffRevision), baseVersion: DEFAULT_TARIFF_VERSION, entries: tariffs },
      updatedAt: this.settings.updatedAt,
    };
  }
}
