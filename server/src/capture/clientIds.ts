import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function pathFor(sessionDir: string): string {
  return join(sessionDir, 'raw', 'accepted-client-ids.json');
}

export function loadClientIds(sessionDir: string): Set<string> {
  const file = pathFor(sessionDir);
  if (!existsSync(file)) return new Set();
  try {
    const ids = JSON.parse(readFileSync(file, 'utf8')) as string[];
    return new Set(ids);
  } catch {
    return new Set();
  }
}

export function rememberClientId(sessionDir: string, ids: Set<string>, clientId: string): void {
  ids.add(clientId);
  writeFileSync(pathFor(sessionDir), JSON.stringify([...ids]), 'utf8');
}
