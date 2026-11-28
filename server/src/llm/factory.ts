import type pg from 'pg';
import type { AppConfig } from '../shared/types.js';
import { LlmService } from './LlmService.js';
import { FileLlmPersistence, PgLlmPersistence } from './persistence.js';

/** Postgres when a pool exists, JSON/JSONL under DATA_DIR otherwise (local mode). */
export async function createLlmService(config: AppConfig, pool: pg.Pool | null): Promise<LlmService> {
  const persistence = pool ? new PgLlmPersistence(pool) : new FileLlmPersistence(config.dataDir);
  return LlmService.create({ persistence });
}
