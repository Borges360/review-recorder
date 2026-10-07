import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from './shared/config.js';
import { existsSync, readFileSync } from 'node:fs';
import { MirrorSessionRepository, SessionRepository } from './persistence/SessionRepository.js';
import { RemoteStores } from './persistence/RemoteStores.js';
import { SessionManager } from './session/SessionManager.js';
import { registerRoutes } from './app/routes.js';
import { registerWebSockets } from './app/websocket.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildApp() {
  const config = loadConfig();
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: config.uiOrigin, credentials: true });
  await app.register(websocket);
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  app.addHook('onRequest', async (req, reply) => {
    if (!config.apiToken) return;
    const path = req.url.split('?')[0] ?? req.url;
    if (path === '/health' || path === '/' || path.startsWith('/demo')) return;
    const header = req.headers.authorization;
    if (header !== `Bearer ${config.apiToken}`) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  const remote = new RemoteStores(config);
  await remote.init();
  const repo = remote.hasDatabase
    ? new MirrorSessionRepository(config.sessionsDir, remote)
    : new SessionRepository(config.sessionsDir);
  const sessions = new SessionManager(config, repo, remote);

  await registerRoutes(app, sessions, config);
  await registerWebSockets(app, sessions);

  // Demo app static files
  const demoAppPath = join(__dirname, '../../fixtures/demo-app');
  await app.register(fastifyStatic, {
    root: demoAppPath,
    prefix: '/demo/',
    decorateReply: false,
  });

  app.get('/demo', async (_req, reply) => {
    return reply.redirect('/demo/index.html');
  });

  const historyPath = existsSync(join(__dirname, '../history/index.html'))
    ? join(__dirname, '../history/index.html')
    : join(__dirname, '../../history/index.html');
  app.get('/', async (_req, reply) => {
    return reply.type('text/html; charset=utf-8').send(readFileSync(historyPath, 'utf8'));
  });

  return { app, config, sessions, repo };
}

async function main() {
  const { app, config } = await buildApp();
  await app.listen({ port: config.port, host: config.host });
  console.log(`Server running at http://${config.host}:${config.port}`);
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === pathToFileURL(process.argv[1]).href ||
    process.argv[1].endsWith('index.ts') ||
    process.argv[1].endsWith('index.js'));

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
