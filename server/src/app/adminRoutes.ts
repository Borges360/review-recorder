import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionManager } from '../session/SessionManager.js';
import { LlmValidationError, type LlmService, type SettingsPatch } from '../llm/LlmService.js';
import { PROVIDER_IDS, type ProviderId } from '../llm/types.js';
import type { AppConfig } from '../shared/types.js';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function tokenMatches(header: string | undefined, token: string): boolean {
  return timingSafeEqual(digest(header ?? ''), digest(`Bearer ${token}`));
}

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/**
 * Admin access. The app has no user accounts, so "admin" is a bearer token:
 *  - ADMIN_TOKEN set  -> only that token opens /admin/* (API_TOKEN is NOT enough);
 *  - else API_TOKEN set -> the existing API token;
 *  - neither -> single-tenant local mode, allowed only when the server listens on loopback.
 */
export function checkAdminAccess(
  config: Pick<AppConfig, 'adminToken' | 'apiToken' | 'host'>,
  authorization: string | undefined,
): { ok: true } | { ok: false; status: 401 | 403; error: string } {
  if (config.adminToken) {
    return tokenMatches(authorization, config.adminToken) ? { ok: true } : { ok: false, status: 401, error: 'unauthorized' };
  }
  if (config.apiToken) {
    return tokenMatches(authorization, config.apiToken) ? { ok: true } : { ok: false, status: 401, error: 'unauthorized' };
  }
  if (isLoopbackHost(config.host)) return { ok: true };
  return { ok: false, status: 403, error: 'admin_disabled: set ADMIN_TOKEN or API_TOKEN to use /admin on a non-loopback host' };
}

export async function registerAdminRoutes(
  app: FastifyInstance,
  sessions: SessionManager,
  config: AppConfig,
): Promise<void> {
  const llm: LlmService = sessions.llm;

  await app.register(
    async (admin) => {
      admin.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
        const access = checkAdminAccess(config, req.headers.authorization);
        if (!access.ok) return reply.code(access.status).send({ error: access.error });
      });

      admin.get('/', async () => llm.view());

      admin.put<{ Body: SettingsPatch }>('/', async (req, reply) => {
        try {
          await llm.update(req.body ?? {});
          return await llm.view();
        } catch (error) {
          if (error instanceof LlmValidationError) return reply.code(400).send({ error: error.message });
          throw error;
        }
      });

      admin.get<{ Querystring: { month?: string } }>('/usage', async (req, reply) => {
        try {
          const report = await llm.usageReport(req.query.month);
          return {
            ...report,
            sessions: report.sessions.map((s) => ({ ...s, name: sessions.getSession(s.sessionId)?.name ?? null })),
          };
        } catch (error) {
          if (error instanceof LlmValidationError) return reply.code(400).send({ error: error.message });
          throw error;
        }
      });

      admin.post<{ Body: { provider?: string } }>('/test', async (req, reply) => {
        const provider = req.body?.provider as ProviderId | undefined;
        if (!provider || !PROVIDER_IDS.includes(provider)) return reply.code(400).send({ error: 'unknown provider' });
        return llm.testConnection(provider);
      });

      admin.get<{ Querystring: { limit?: string } }>('/audit', async (req) => ({
        entries: await llm.audit(Number(req.query.limit ?? 50) || 50),
      }));
    },
    { prefix: '/admin/llm' },
  );
}
