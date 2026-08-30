import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { SessionRecord, SessionStatus } from '../shared/types.js';
import { resolveSessionOutputDir } from '../shared/config.js';

interface SessionIndex {
  sessions: Record<string, SessionRecord>;
}

export class SessionRepository {
  private readonly sessionsDir: string;
  private readonly indexPath: string;
  private index: SessionIndex;

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
    if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });
    this.indexPath = join(sessionsDir, 'sessions-index.json');
    this.index = this.loadIndex();
    this.migrateLegacyIndex();
    this.syncFromDirectories();
  }

  private migrateLegacyIndex(): void {
    const legacyIndexPath = join(this.sessionsDir, '..', 'server', 'sessions', 'sessions-index.json');
    if (!existsSync(legacyIndexPath)) return;
    try {
      const legacy = JSON.parse(readFileSync(legacyIndexPath, 'utf8')) as SessionIndex;
      for (const [id, record] of Object.entries(legacy.sessions)) {
        if (!this.index.sessions[id]) {
          this.index.sessions[id] = record;
        }
      }
      this.saveIndex();
    } catch {
      /* ignore corrupt legacy index */
    }
  }

  private loadIndex(): SessionIndex {
    if (!existsSync(this.indexPath)) return { sessions: {} };
    try {
      return JSON.parse(readFileSync(this.indexPath, 'utf8')) as SessionIndex;
    } catch {
      return { sessions: {} };
    }
  }

  private saveIndex(): void {
    writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2), 'utf8');
  }

  private syncFromDirectories(): void {
    for (const entry of readdirSync(this.sessionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dir = join(this.sessionsDir, entry.name);
      const sessionPath = join(dir, 'session.json');
      if (!existsSync(sessionPath)) continue;
      try {
        const record = JSON.parse(readFileSync(sessionPath, 'utf8')) as SessionRecord;
        if (!record.id) continue;
        const existing = this.index.sessions[record.id];
        if (!existing || (record.outputDir && existing.outputDir !== record.outputDir)) {
          this.index.sessions[record.id] = record;
        }
      } catch {
        /* ignore corrupt session files */
      }
    }
    this.saveIndex();
  }

  private writeSessionFile(session: SessionRecord): void {
    if (!session.outputDir) return;
    const dir = resolveSessionOutputDir(this.sessionsDir, session.outputDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'session.json'), JSON.stringify(session, null, 2), 'utf8');
  }

  createSession(session: SessionRecord): void {
    this.index.sessions[session.id] = session;
    this.saveIndex();
  }

  updateSession(id: string, patch: Partial<SessionRecord>): void {
    const session = this.index.sessions[id];
    if (!session) return;
    Object.assign(session, patch);
    this.saveIndex();
    this.writeSessionFile(session);
  }

  getSession(id: string): SessionRecord | null {
    return this.index.sessions[id] ?? null;
  }

  listSessions(limit = 20): SessionRecord[] {
    return Object.values(this.index.sessions)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  findRecoverableSessions(): SessionRecord[] {
    return Object.values(this.index.sessions).filter(
      (s) => s.status === 'RECORDING' || s.status === 'PAUSED',
    );
  }

  markRecoverable(statuses: SessionStatus[]): void {
    for (const s of this.findRecoverableSessions()) {
      if (statuses.includes(s.status)) {
        this.updateSession(s.id, { status: 'RECOVERABLE' });
      }
    }
  }
}
