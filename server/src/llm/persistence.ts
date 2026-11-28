import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';
import { emptySettings, type AuditRecord, type StoredLlmSettings, type UsageRecord } from './types.js';

export interface LlmPersistence {
  loadSettings(): Promise<StoredLlmSettings | null>;
  saveSettings(settings: StoredLlmSettings): Promise<void>;
  appendUsage(record: UsageRecord): Promise<void>;
  /** Records with `at >= sinceIso` (all when omitted), oldest first. */
  listUsage(sinceIso?: string): Promise<UsageRecord[]>;
  appendAudit(record: AuditRecord): Promise<void>;
  listAudit(limit: number): Promise<AuditRecord[]>;
}

function normalizeSettings(raw: Partial<StoredLlmSettings> | null): StoredLlmSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const base = emptySettings();
  return {
    ...base,
    ...raw,
    routes: raw.routes ?? {},
    keyRefs: raw.keyRefs ?? {},
    budget: { ...base.budget, ...(raw.budget ?? {}) },
    tariffs: raw.tariffs ?? {},
  };
}

export class MemoryLlmPersistence implements LlmPersistence {
  private settings: StoredLlmSettings | null = null;
  private usage: UsageRecord[] = [];
  private audit: AuditRecord[] = [];

  async loadSettings() {
    return this.settings ? structuredClone(this.settings) : null;
  }
  async saveSettings(settings: StoredLlmSettings) {
    this.settings = structuredClone(settings);
  }
  async appendUsage(record: UsageRecord) {
    this.usage.push(record);
  }
  async listUsage(sinceIso?: string) {
    return this.usage.filter((r) => !sinceIso || r.at >= sinceIso);
  }
  async appendAudit(record: AuditRecord) {
    this.audit.push(record);
  }
  async listAudit(limit: number) {
    return this.audit.slice(-limit).reverse();
  }
}

/** Local mode (no DATABASE_URL): JSON + JSONL files under DATA_DIR. */
export class FileLlmPersistence implements LlmPersistence {
  private readonly settingsPath: string;
  private readonly usagePath: string;
  private readonly auditPath: string;

  constructor(dataDir: string) {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    this.settingsPath = join(dataDir, 'llm-settings.json');
    this.usagePath = join(dataDir, 'llm-usage.jsonl');
    this.auditPath = join(dataDir, 'llm-audit.jsonl');
  }

  async loadSettings() {
    if (!existsSync(this.settingsPath)) return null;
    try {
      return normalizeSettings(JSON.parse(readFileSync(this.settingsPath, 'utf8')) as StoredLlmSettings);
    } catch {
      return null;
    }
  }

  async saveSettings(settings: StoredLlmSettings) {
    writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  }

  async appendUsage(record: UsageRecord) {
    appendFileSync(this.usagePath, JSON.stringify(record) + '\n', 'utf8');
  }

  async listUsage(sinceIso?: string) {
    return this.readJsonl<UsageRecord>(this.usagePath).filter((r) => !sinceIso || r.at >= sinceIso);
  }

  async appendAudit(record: AuditRecord) {
    appendFileSync(this.auditPath, JSON.stringify(record) + '\n', 'utf8');
  }

  async listAudit(limit: number) {
    return this.readJsonl<AuditRecord>(this.auditPath).slice(-limit).reverse();
  }

  private readJsonl<T>(path: string): T[] {
    if (!existsSync(path)) return [];
    const out: T[] = [];
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as T);
      } catch {
        /* skip a torn line */
      }
    }
    return out;
  }
}

/** Postgres mode: tables created by persistence/schema.ts (idempotent). */
export class PgLlmPersistence implements LlmPersistence {
  constructor(private readonly pool: pg.Pool) {}

  async loadSettings() {
    const res = await this.pool.query('SELECT value FROM app_settings WHERE key = $1', ['llm']);
    return normalizeSettings((res.rows[0]?.value as StoredLlmSettings | undefined) ?? null);
  }

  async saveSettings(settings: StoredLlmSettings) {
    await this.pool.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      ['llm', JSON.stringify(settings)],
    );
  }

  async appendUsage(r: UsageRecord) {
    await this.pool.query(
      `INSERT INTO llm_usage (id, at, session_id, task, provider, model, audio_seconds, input_tokens,
         output_tokens, cost_usd, tariff_version, ok)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
      [r.id, r.at, r.sessionId, r.task, r.provider, r.model, r.audioSeconds, r.inputTokens, r.outputTokens, r.costUsd, r.tariffVersion, r.ok],
    );
  }

  async listUsage(sinceIso?: string) {
    const res = await this.pool.query(
      `SELECT id, at, session_id, task, provider, model, audio_seconds, input_tokens, output_tokens,
              cost_usd, tariff_version, ok
         FROM llm_usage WHERE ($1::timestamptz IS NULL OR at >= $1::timestamptz) ORDER BY at ASC`,
      [sinceIso ?? null],
    );
    return res.rows.map(
      (row): UsageRecord => ({
        id: row.id,
        at: new Date(row.at).toISOString(),
        sessionId: row.session_id,
        task: row.task,
        provider: row.provider,
        model: row.model,
        audioSeconds: Number(row.audio_seconds),
        inputTokens: Number(row.input_tokens),
        outputTokens: Number(row.output_tokens),
        costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
        tariffVersion: row.tariff_version,
        ok: row.ok,
      }),
    );
  }

  async appendAudit(record: AuditRecord) {
    await this.pool.query('INSERT INTO llm_audit (at, action, changes) VALUES ($1,$2,$3::jsonb)', [
      record.at,
      record.action,
      JSON.stringify(record.changes),
    ]);
  }

  async listAudit(limit: number) {
    const res = await this.pool.query('SELECT at, action, changes FROM llm_audit ORDER BY at DESC LIMIT $1', [limit]);
    return res.rows.map(
      (row): AuditRecord => ({ at: new Date(row.at).toISOString(), action: row.action, changes: row.changes as string[] }),
    );
  }
}
