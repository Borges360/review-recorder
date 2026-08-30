import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { globalEventBus } from '../timeline/EventBus.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { EventEnvelope } from '../shared/types.js';

export async function registerWebSockets(app: FastifyInstance, sessions: SessionManager): Promise<void> {
  app.get('/sessions/:id/events', { websocket: true }, (socket: WebSocket, req) => {
    const sessionId = (req.params as { id: string }).id;
    const listener = (event: EventEnvelope) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(event));
      }
    };
    globalEventBus.on(`session:${sessionId}`, listener);
    socket.on('close', () => {
      globalEventBus.off(`session:${sessionId}`, listener);
    });
  });

  app.get('/sessions/:id/audio', { websocket: true }, (socket: WebSocket, req) => {
    const sessionId = (req.params as { id: string }).id;
    socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      sessions.handleAudio(sessionId, buf);
    });
  });
}
