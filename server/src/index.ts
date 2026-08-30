import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from './shared/config.js';
import { SessionRepository } from './persistence/SessionRepository.js';
import { SessionManager } from './session/SessionManager.js';
import { registerRoutes } from './app/routes.js';
import { registerWebSockets } from './app/websocket.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildApp() {
  const config = loadConfig();
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: config.uiOrigin, credentials: true });
  await app.register(websocket);

  const repo = new SessionRepository(config.sessionsDir);
  const sessions = new SessionManager(config, repo);

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

  return { app, config, sessions, repo };
}

async function main() {
  const { app, config } = await buildApp();
  await app.listen({ port: config.port, host: '127.0.0.1' });
  console.log(`Server running at http://127.0.0.1:${config.port}`);
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
