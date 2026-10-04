/**
 * tests/call-machine.test.ts — unit tests for the pure call-state machine
 * (`lib/webrtc/callMachine.ts`). Every legal path and a set of illegal
 * transitions are covered; illegal transitions must leave state untouched.
 */
import { describe, expect, it } from 'vitest';
import {
  callReducer,
  initialCallState,
  isCallActive,
  isTerminal,
  type CallState,
} from '@/lib/webrtc/callMachine';

const s = (overrides: Partial<CallState> = {}): CallState => ({
  ...initialCallState,
  ...overrides,
});

describe('outgoing call happy path', () => {
  it('idle → dialing → outgoing-ringing → connecting → connected → ended', () => {
    let st = s();
    st = callReducer(st, { type: 'DIAL' });
    expect(st.phase).toBe('dialing');

    st = callReducer(st, { type: 'CALL_CREATED', callId: 'c1' });
    expect(st.phase).toBe('outgoing-ringing');
    expect(st.callId).toBe('c1');

    st = callReducer(st, { type: 'ACCEPTED_REMOTE' });
    expect(st.phase).toBe('connecting');

    st = callReducer(st, { type: 'MEDIA_CONNECTED' });
    expect(st.phase).toBe('connected');
    expect(isCallActive(st.phase)).toBe(true);

    st = callReducer(st, { type: 'HANGUP_LOCAL' });
    expect(st.phase).toBe('ended');
    expect(st.endReason).toBe('hung-up');
    expect(isTerminal(st.phase)).toBe(true);
  });

  it('callee decline ends an outgoing call as declined-remote', () => {
    let st = s({ phase: 'outgoing-ringing', callId: 'c1' });
    st = callReducer(st, { type: 'REJECTED_REMOTE' });
    expect(st.phase).toBe('ended');
    expect(st.endReason).toBe('declined-remote');
  });

  it('unanswered outgoing call ends as no-answer', () => {
    const st = callReducer(s({ phase: 'outgoing-ringing', callId: 'c1' }), {
      type: 'NO_ANSWER',
    });
    expect(st.phase).toBe('ended');
    expect(st.endReason).toBe('no-answer');
  });

  it('remote hangup of a connected call ends as remote-hangup', () => {
    const st = callReducer(s({ phase: 'connected', callId: 'c1' }), {
      type: 'ENDED_REMOTE',
    });
    expect(st.phase).toBe('ended');
    expect(st.endReason).toBe('remote-hangup');
  });
});

describe('incoming call happy path', () => {
  it('idle → incoming-ringing → connecting → connected', () => {
    let st = s();
    st = callReducer(st, { type: 'INCOMING', callId: 'c9' });
    expect(st.phase).toBe('incoming-ringing');
    expect(st.callId).toBe('c9');

    st = callReducer(st, { type: 'ACCEPT_LOCAL' });
    expect(st.phase).toBe('connecting');

    st = callReducer(st, { type: 'MEDIA_CONNECTED' });
    expect(st.phase).toBe('connected');
  });

  it('declining an incoming call ends as declined-local', () => {
    const st = callReducer(s({ phase: 'incoming-ringing', callId: 'c9' }), {
      type: 'REJECT_LOCAL',
    });
    expect(st.phase).toBe('ended');
    expect(st.endReason).toBe('declined-local');
  });

  it('ring timeout on an incoming call ends as missed', () => {
    const st = callReducer(s({ phase: 'incoming-ringing', callId: 'c9' }), {
      type: 'MISSED',
    });
    expect(st.phase).toBe('ended');
    expect(st.endReason).toBe('missed');
  });
});

describe('reconnect cycle', () => {
  it('connected → reconnecting → connected', () => {
    let st = s({ phase: 'connected', callId: 'c1' });
    st = callReducer(st, { type: 'ICE_RESTARTING' });
    expect(st.phase).toBe('reconnecting');
    expect(isCallActive(st.phase)).toBe(true);

    st = callReducer(st, { type: 'ICE_RESTORED' });
    expect(st.phase).toBe('connected');
  });

  it('failed ICE restart moves to failed with a reason', () => {
    const st = callReducer(s({ phase: 'reconnecting', callId: 'c1' }), {
      type: 'FAIL',
      reason: 'ice-failed',
      detail: 'network down',
    });
    expect(st.phase).toBe('failed');
    expect(st.failReason).toBe('ice-failed');
    expect(st.failDetail).toBe('network down');
  });

  it('remote failure is distinguished from local failure', () => {
    const st = callReducer(s({ phase: 'connected', callId: 'c1' }), {
      type: 'REMOTE_FAILED',
      detail: 'ice-failed',
    });
    expect(st.phase).toBe('failed');
    expect(st.failReason).toBe('remote-failed');
  });
});

describe('recovery from terminal states', () => {
  it('failed → retry → dialing (callId cleared) and dismiss → idle', () => {
    let st = s({ phase: 'failed', callId: 'c1', failReason: 'ice-failed' });
    st = callReducer(st, { type: 'RETRY' });
    expect(st.phase).toBe('dialing');
    expect(st.callId).toBeNull();
    expect(st.failReason).toBeNull();

    st = callReducer(s({ phase: 'ended', callId: 'c2', endReason: 'hung-up' }), {
      type: 'DISMISS',
    });
    expect(st.phase).toBe('idle');
    expect(st.callId).toBeNull();
  });

  it('a new incoming call can arrive while in a terminal state', () => {
    const st = callReducer(s({ phase: 'failed', callId: 'c1' }), {
      type: 'INCOMING',
      callId: 'c2',
    });
    expect(st.phase).toBe('incoming-ringing');
    expect(st.callId).toBe('c2');
  });

  it('DISMISS works as a hard reset from any phase', () => {
    for (const phase of [
      'dialing',
      'outgoing-ringing',
      'incoming-ringing',
      'connecting',
      'connected',
      'reconnecting',
    ] as const) {
      const st = callReducer(s({ phase, callId: 'c1' }), { type: 'DISMISS' });
      expect(st.phase).toBe('idle');
    }
  });
});

describe('illegal transitions are ignored', () => {
  it('hangup in idle leaves state untouched (same reference)', () => {
    const before = s();
    expect(callReducer(before, { type: 'HANGUP_LOCAL' })).toBe(before);
  });

  it('accept-remote in idle is ignored', () => {
    const before = s();
    expect(callReducer(before, { type: 'ACCEPTED_REMOTE' })).toBe(before);
  });

  it('media-connected while ringing is ignored', () => {
    const before = s({ phase: 'outgoing-ringing', callId: 'c1' });
    expect(callReducer(before, { type: 'MEDIA_CONNECTED' })).toBe(before);
  });

  it('accept-local twice: second is ignored', () => {
    const once = callReducer(s({ phase: 'incoming-ringing', callId: 'c1' }), {
      type: 'ACCEPT_LOCAL',
    });
    expect(once.phase).toBe('connecting');
    expect(callReducer(once, { type: 'ACCEPT_LOCAL' })).toBe(once);
  });

  it('retry from a non-terminal phase is ignored', () => {
    const before = s({ phase: 'connected', callId: 'c1' });
    expect(callReducer(before, { type: 'RETRY' })).toBe(before);
  });
});
