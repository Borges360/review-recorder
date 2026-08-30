import type { SessionStatus } from '../shared/types.js';

const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  CREATED: ['STARTING', 'FAILED'],
  STARTING: ['RECORDING', 'FAILED'],
  RECORDING: ['PAUSED', 'STOPPING', 'FAILED', 'RECOVERABLE'],
  PAUSED: ['RECORDING', 'STOPPING', 'FAILED', 'RECOVERABLE'],
  STOPPING: ['PROCESSING', 'FAILED'],
  PROCESSING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
  RECOVERABLE: ['STOPPING', 'FAILED', 'RECORDING'],
};

export class InvalidSessionTransitionError extends Error {
  constructor(from: SessionStatus, to: SessionStatus) {
    super(`Invalid session transition: ${from} -> ${to}`);
    this.name = 'InvalidSessionTransitionError';
  }
}

export class SessionStateMachine {
  private status: SessionStatus;

  constructor(initial: SessionStatus = 'CREATED') {
    this.status = initial;
  }

  getStatus(): SessionStatus {
    return this.status;
  }

  transition(to: SessionStatus): SessionStatus {
    const allowed = VALID_TRANSITIONS[this.status];
    if (!allowed.includes(to)) {
      throw new InvalidSessionTransitionError(this.status, to);
    }
    this.status = to;
    return this.status;
  }

  canTransition(to: SessionStatus): boolean {
    return VALID_TRANSITIONS[this.status].includes(to);
  }
}
