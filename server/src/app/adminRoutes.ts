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

export function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export interface AdminRequestContext {
  /** True for anything that is not a plain read (PUT settings, POST test). */
  mutation?: boolean;
  /** Socket peer address (not a header). */
  remoteAddress?: string;
  /** True when the request carries reverse-proxy headers (Forwarded, X-Forwarded-*, X-Real-IP). */
  proxied?: boolean;
}

/**
 * Admin access. The app has no user accounts, so "admin" is a bearer token:
 *  - ADMIN_TOKEN set  -> only that token opens /admin/* (API_TOKEN is NOT enough);
 *  - else API_TOKEN set -> the API token may READ /admin/*, but changing anything (settings, connection
 *    test) requires ADMIN_TOKEN, so any ordinary API client cannot become admin;
 *  - neither -> single-tenant local mode: allowed only when the server listens on loopback AND the
 *    request itself comes straight from a loopback peer (a reverse proxy/tunnel on the same host is refused).
 */
export function checkAdminAccess(
  config: Pick<AppConfig, 'adminToken' | 'apiToken' | 'host'>,
  authorization: string | undefined,
  ctx: AdminRequestContext = {},
): { ok: true } | { ok: false; status: 401 | 403; error: string } {
  if (config.adminToken) {
    return tokenMatches(authorization, config.adminToken) ? { ok: true } : { ok: false, status: 401, error: 'unauthorized' };
  }
  if (config.apiToken) {
    if (!tokenMatches(authorization, config.apiToken)) return { ok: false, status: 401, error: 'unauthorized' };
    if (ctx.mutation) {
      return { ok: false, status: 403, error: 'admin_token_required: set ADMIN_TOKEN to change LLM settings or test connections' };
    }
    return { ok: true };
  }
  if (!isLoopbackHost(config.host)) {
    return { ok: false, status: 403, error: 'admin_disabled: set ADMIN_TOKEN to use /admin on a non-loopback host' };
  }
  if (ctx.proxied || (ctx.remoteAddress !== undefined && !isLoopbackAddress(ctx.remoteAddress))) {
    return { ok: false, status: 403, error: 'admin_disabled: set ADMIN_TOKEN to use /admin through a proxy or from another host' };
  }
  return { ok: true };
}

const PROXY_HEADERS = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip'];

export async function registerAdminRoutes(
  app: FastifyInstance,
  sessions: SessionManager,
  config: AppConfig,
): Promise<void> {
  const llm: LlmService = sessions.llm;

  await app.register(
    async (admin) => {
      admin.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
        const access = checkAdminAccess(config, req.headers.authorization, {
          mutation: req.method !== 'GET' && req.method !== 'HEAD',
          remoteAddress: req.socket?.remoteAddress,
          proxied: PROXY_HEADERS.some((h) => req.headers[h] !== undefined),
        });
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
