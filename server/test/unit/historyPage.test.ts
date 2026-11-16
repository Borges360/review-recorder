import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/index.js';

describe('histórico com INTEIRO', () => {
  it('serve a página e o CSS sem bearer e mantém /sessions protegido', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rr-history-page-'));
    const previous = {
      token: process.env.API_TOKEN,
      sessions: process.env.SESSIONS_DIR,
      data: process.env.DATA_DIR,
      profile: process.env.BROWSER_PROFILE_DIR,
    };
    process.env.API_TOKEN = 'secret';
    process.env.SESSIONS_DIR = join(root, 'sessions');
    process.env.DATA_DIR = join(root, 'data');
    process.env.BROWSER_PROFILE_DIR = join(root, 'profile');
    let closeApp: (() => Promise<void>) | undefined;
    try {
      const { app } = await buildApp();
      closeApp = () => app.close();
      const page = await app.inject({ method: 'GET', url: '/' });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('data-in-theme="dark"');
      expect(page.body).toContain('data-in-density="focus"');
      expect(page.body).toContain('/assets/inteiro/tokens.css');
      expect(page.body).toContain('in-button--primary');
      expect(page.body).toContain('id="finalize" class="in-button in-button--secondary"');
      expect(page.body).not.toContain('in-button--commit');

      const tokens = await app.inject({ method: 'GET', url: '/assets/inteiro/tokens.css' });
      expect(tokens.statusCode).toBe(200);
      expect(tokens.headers['content-type']).toContain('text/css');
      expect(tokens.body).toContain('--in-color-identity-primary');

      const components = await app.inject({ method: 'GET', url: '/assets/inteiro/components.css' });
      expect(components.statusCode).toBe(200);
      expect(components.body).toContain('.in-button--commit');

      const fontCss = await app.inject({ method: 'GET', url: '/assets/inteiro/recursive/fonts.css' });
      expect(fontCss.statusCode).toBe(200);
      expect(fontCss.body).toContain('recursive-latin.woff2');
      const font = await app.inject({ method: 'GET', url: '/assets/inteiro/recursive/recursive-latin.woff2' });
      expect(font.statusCode).toBe(200);
      expect(font.headers['content-type']).toContain('font/woff2');
      expect(font.rawPayload.subarray(0, 4).toString()).toBe('wOF2');

      const denied = await app.inject({ method: 'GET', url: '/sessions' });
      expect(denied.statusCode).toBe(401);
    } finally {
      try {
        await closeApp?.();
      } finally {
        if (previous.token === undefined) delete process.env.API_TOKEN;
        else process.env.API_TOKEN = previous.token;
        if (previous.sessions === undefined) delete process.env.SESSIONS_DIR;
        else process.env.SESSIONS_DIR = previous.sessions;
        if (previous.data === undefined) delete process.env.DATA_DIR;
        else process.env.DATA_DIR = previous.data;
        if (previous.profile === undefined) delete process.env.BROWSER_PROFILE_DIR;
        else process.env.BROWSER_PROFILE_DIR = previous.profile;
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});
