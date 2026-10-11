import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/index.js';

describe('histórico com INTEIRO', () => {
  it('serve a página e o CSS sem bearer e mantém /sessions protegido', async () => {
    const previousToken = process.env.API_TOKEN;
    process.env.API_TOKEN = 'secret';
    process.env.SESSIONS_DIR = './test-sessions-inteiro';
    process.env.DATA_DIR = './test-data-inteiro';
    const { app } = await buildApp();
    try {
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
      await app.close();
      if (previousToken === undefined) delete process.env.API_TOKEN;
      else process.env.API_TOKEN = previousToken;
    }
  });
});
