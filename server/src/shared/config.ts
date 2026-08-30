import { config as loadDotenv } from 'dotenv';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import type { AppConfig } from '../shared/types.js';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

loadDotenv({ path: join(projectRoot, '.env') });

function resolveProjectPath(path: string): string {
  return isAbsolute(path) ? path : resolve(projectRoot, path);
}

export function resolveSessionOutputDir(sessionsDir: string, outputDir: string): string {
  if (isAbsolute(outputDir)) return outputDir;
  const normalized = outputDir.replace(/^sessions[\\/]/, '');
  const primary = resolve(sessionsDir, normalized);
  if (existsSync(primary)) return primary;
  const legacy = resolve(sessionsDir, '..', 'server', 'sessions', normalized);
  if (existsSync(legacy)) return legacy;
  return primary;
}

export function loadConfig(): AppConfig {
  const port = Number(process.env.PORT ?? 3000);
  const uiOrigin = process.env.UI_ORIGIN ?? 'http://127.0.0.1:5179';
  const sessionsDir = resolveProjectPath(process.env.SESSIONS_DIR ?? 'sessions');
  const dataDir = resolveProjectPath(process.env.DATA_DIR ?? 'data');
  const browserProfileDir = process.env.BROWSER_PROFILE_DIR
    ? resolveProjectPath(process.env.BROWSER_PROFILE_DIR)
    : join(homedir(), '.ui-review', 'browser-profile');
  const openaiApiKey = process.env.OPENAI_API_KEY ?? null;
  const diagnosticTrace = process.env.DIAGNOSTIC_TRACE === 'true';
  const useFakeTranscriber = process.env.USE_FAKE_TRANSCRIBER === 'true';
  const mockBrowser = process.env.MOCK_BROWSER === 'true';
  const browserHeadless = process.env.BROWSER_HEADLESS === 'true';

  for (const dir of [sessionsDir, dataDir, browserProfileDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  return {
    port,
    uiOrigin,
    sessionsDir,
    dataDir,
    browserProfileDir,
    openaiApiKey,
    diagnosticTrace,
    useFakeTranscriber,
    mockBrowser,
    browserHeadless,
  };
}
