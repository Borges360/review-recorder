import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SessionManager } from '../session/SessionManager.js';
import { SessionCompiler } from '../export/SessionCompiler.js';
import type { AppConfig } from '../shared/types.js';
import { resolveSessionOutputDir } from '../shared/config.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: message });
}

function notFound(reply: FastifyReply, message: string) {
  return reply.code(404).send({ error: message });
}

export async function registerRoutes(
  app: FastifyInstance,
  sessions: SessionManager,
  config: AppConfig,
): Promise<void> {
  app.get('/health', async () => ({ ok: true }));

  app.get('/config', async () => ({
    openaiConfigured: Boolean(config.openaiApiKey),
  }));

  app.get('/sessions', async () => sessions.listSessions());

  app.post<{ Body: { name: string; initialUrl?: string; description?: string } }>(
    '/sessions',
    async (req, reply) => {
      const { name, initialUrl, description } = req.body;
      if (!name?.trim()) return badRequest(reply, 'name is required');
      return sessions.createSession(name.trim(), initialUrl, description);
    },
  );

  app.get<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    const session = sessions.getSession(req.params.id);
    if (!session) return notFound(reply, 'Session not found');
    return session;
  });

  app.post<{ Params: { id: string } }>('/sessions/:id/start', async (req) => {
    return sessions.startSession(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/sessions/:id/pause', async (req) => {
    return sessions.pauseSession(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/sessions/:id/resume', async (req) => {
    return sessions.resumeSession(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/sessions/:id/screenshot', async (req) => {
    return sessions.screenshotSession(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/sessions/:id/stop', async (req) => {
    return sessions.stopSession(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/sessions/:id/reopen-browser', async (req) => {
    await sessions.reopenBrowser(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/sessions/:id/finalize', async (req, reply) => {
    try {
      return await sessions.finalizeRecoverableSession(req.params.id);
    } catch (e) {
      return badRequest(reply, String(e));
    }
  });

  app.get<{ Params: { id: string } }>('/sessions/:id/timeline', async (req, reply) => {
    try {
      const timeline = await sessions.getTimeline(req.params.id);
      return { sessionId: req.params.id, timeline };
    } catch (e) {
      return notFound(reply, String(e));
    }
  });

  if (process.env.MOCK_BROWSER === 'true') {
    app.post<{ Params: { id: string }; Body: { type: string; payload: Record<string, unknown> } }>(
      '/sessions/:id/test/browser-event',
      async (req, reply) => {
        try {
          sessions.injectMockBrowserEvent(req.params.id, req.body.type, req.body.payload);
          return { ok: true };
        } catch (e) {
          return badRequest(reply, String(e));
        }
      },
    );

    app.post<{
      Params: { id: string };
      Body: {
        fingerprint: string;
        url: string;
        normalizedRoute: string;
        title: string;
        ariaSnapshot: string;
        dialogs: string[];
        isNew: boolean;
      };
    }>('/sessions/:id/test/screen-state', async (req, reply) => {
      try {
        sessions.injectMockScreenState(req.params.id, req.body);
        return { ok: true };
      } catch (e) {
        return badRequest(reply, String(e));
      }
    });
  }

  app.get<{ Params: { id: string } }>('/sessions/:id/export', async (req, reply) => {
    const session = sessions.getSession(req.params.id);
    if (!session?.outputDir) return notFound(reply, 'No export available');
    const outputDir = resolveSessionOutputDir(config.sessionsDir, session.outputDir);
    const jsonPath = join(outputDir, 'review.json');
    const mdPath = join(outputDir, 'REVIEW.md');
    if (!existsSync(jsonPath)) {
      const compiler = new SessionCompiler(outputDir, sessions.repo);
      await compiler.compile(req.params.id);
    }
    return {
      reviewJson: existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, 'utf8')) : null,
      reviewMd: existsSync(mdPath) ? readFileSync(mdPath, 'utf8') : null,
      outputDir,
    };
  });
}
