import { describe, it, expect } from 'vitest';
import { SessionStateMachine, InvalidSessionTransitionError } from '../../src/session/SessionState.js';

describe('SessionStateMachine', () => {
  it('allows valid lifecycle transitions', () => {
    const fsm = new SessionStateMachine('CREATED');
    fsm.transition('STARTING');
    fsm.transition('RECORDING');
    fsm.transition('PAUSED');
    fsm.transition('RECORDING');
    fsm.transition('STOPPING');
    fsm.transition('PROCESSING');
    fsm.transition('COMPLETED');
    expect(fsm.getStatus()).toBe('COMPLETED');
  });

  it('rejects invalid transitions', () => {
    const fsm = new SessionStateMachine('CREATED');
    expect(() => fsm.transition('RECORDING')).toThrow(InvalidSessionTransitionError);
  });
});
