import { EventEmitter } from 'node:events';
import type { EventEnvelope } from '../shared/types.js';

export class EventBus extends EventEmitter {
  publish(event: EventEnvelope): void {
    this.emit('event', event);
    this.emit(`session:${event.sessionId}`, event);
  }
}

export const globalEventBus = new EventBus();
