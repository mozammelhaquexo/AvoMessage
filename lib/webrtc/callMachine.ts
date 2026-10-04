/**
 * lib/webrtc/callMachine.ts — pure call-state machine for AvoMessage calls.
 *
 * Single source of truth for legal phase transitions, shared by
 * `useWebRTC` (1:1 + group mesh). Pure reducer → unit-tested in
 * `tests/call-machine.test.ts`. No DOM, no sockets, no side effects.
 *
 * Phases:
 *   idle → dialing → outgoing-ringing → connecting → connected
 *     ↘ incoming-ringing → connecting …
 *   connecting → reconnecting → connected | failed
 *   any active → ended | failed
 *
 * Terminal states keep a reason so the UI can explain what happened
 * (declined vs missed vs failed) without guessing.
 */

export type CallPhase =
  | 'idle'
  | 'dialing'
  | 'outgoing-ringing'
  | 'incoming-ringing'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'ended'
  | 'failed';

export type CallEndReason =
  | 'hung-up' // we hung up
  | 'remote-hangup' // peer hung up
  | 'declined-local' // we declined an incoming call
  | 'declined-remote' // callee declined
  | 'missed' // incoming call we never answered (server ring timeout)
  | 'no-answer' // outgoing call nobody picked up
  | 'busy'; // we auto-declined because we were already in a call

export type CallFailReason =
  | 'ice-failed'
  | 'media-denied'
  | 'media-unavailable'
  | 'signaling-error'
  | 'unsupported'
  | 'remote-failed'
  | 'unknown';

export interface CallState {
  phase: CallPhase;
  /** Active (or most recent) call id; null in idle. */
  callId: string | null;
  endReason: CallEndReason | null;
  failReason: CallFailReason | null;
  /** Human-readable detail for `failed` (already mapped, safe to show). */
  failDetail: string | null;
}

export const initialCallState: CallState = {
  phase: 'idle',
  callId: null,
  endReason: null,
  failReason: null,
  failDetail: null,
};

export type CallAction =
  | { type: 'DIAL'; callId?: string }
  | { type: 'CALL_CREATED'; callId: string }
  | { type: 'INCOMING'; callId: string }
  | { type: 'ACCEPT_LOCAL' }
  | { type: 'ACCEPTED_REMOTE' }
  | { type: 'MEDIA_CONNECTED' }
  | { type: 'ICE_RESTARTING' }
  | { type: 'ICE_RESTORED' }
  | { type: 'REJECT_LOCAL' }
  | { type: 'REJECTED_REMOTE' }
  | { type: 'HANGUP_LOCAL' }
  | { type: 'ENDED_REMOTE'; reason?: CallEndReason }
  | { type: 'MISSED' }
  | { type: 'NO_ANSWER' }
  | { type: 'BUSY_DECLINE' }
  | { type: 'FAIL'; reason: CallFailReason; detail?: string }
  | { type: 'REMOTE_FAILED'; detail?: string }
  | { type: 'RETRY' }
  | { type: 'DISMISS' };

type Transition = Partial<Record<CallAction['type'], CallPhase>>;

/**
 * Legal transitions. Anything not listed is rejected (reducer returns the
 * state unchanged) — the hook logs these as programming errors.
 */
const TRANSITIONS: Record<CallPhase, Transition> = {
  idle: {
    DIAL: 'dialing',
    INCOMING: 'incoming-ringing',
    DISMISS: 'idle',
  },
  dialing: {
    CALL_CREATED: 'outgoing-ringing',
    FAIL: 'failed',
    HANGUP_LOCAL: 'ended',
    DISMISS: 'idle',
  },
  'outgoing-ringing': {
    ACCEPTED_REMOTE: 'connecting',
    REJECTED_REMOTE: 'ended',
    NO_ANSWER: 'ended',
    ENDED_REMOTE: 'ended',
    HANGUP_LOCAL: 'ended',
    FAIL: 'failed',
    REMOTE_FAILED: 'failed',
    DISMISS: 'idle',
  },
  'incoming-ringing': {
    ACCEPT_LOCAL: 'connecting',
    REJECT_LOCAL: 'ended',
    BUSY_DECLINE: 'ended',
    MISSED: 'ended',
    ENDED_REMOTE: 'ended',
    FAIL: 'failed',
    DISMISS: 'idle',
  },
  connecting: {
    MEDIA_CONNECTED: 'connected',
    ICE_RESTARTING: 'reconnecting',
    HANGUP_LOCAL: 'ended',
    ENDED_REMOTE: 'ended',
    REJECTED_REMOTE: 'ended',
    FAIL: 'failed',
    REMOTE_FAILED: 'failed',
    MISSED: 'ended',
    DISMISS: 'idle',
  },
  connected: {
    ICE_RESTARTING: 'reconnecting',
    HANGUP_LOCAL: 'ended',
    ENDED_REMOTE: 'ended',
    FAIL: 'failed',
    REMOTE_FAILED: 'failed',
    DISMISS: 'idle',
  },
  reconnecting: {
    ICE_RESTORED: 'connected',
    MEDIA_CONNECTED: 'connected',
    HANGUP_LOCAL: 'ended',
    ENDED_REMOTE: 'ended',
    FAIL: 'failed',
    REMOTE_FAILED: 'failed',
    DISMISS: 'idle',
  },
  ended: {
    RETRY: 'dialing',
    DISMISS: 'idle',
    INCOMING: 'incoming-ringing',
    DIAL: 'dialing',
  },
  failed: {
    RETRY: 'dialing',
    DISMISS: 'idle',
    INCOMING: 'incoming-ringing',
    DIAL: 'dialing',
  },
};

function endReasonFor(action: CallAction, phase: CallPhase): CallEndReason | null {
  switch (action.type) {
    case 'HANGUP_LOCAL':
      return 'hung-up';
    case 'REJECT_LOCAL':
      return 'declined-local';
    case 'REJECTED_REMOTE':
      return 'declined-remote';
    case 'MISSED':
      return 'missed';
    case 'NO_ANSWER':
      return 'no-answer';
    case 'BUSY_DECLINE':
      return 'busy';
    case 'ENDED_REMOTE':
      if (action.reason) return action.reason;
      // An unanswered outgoing call that ends remotely was never picked up.
      return phase === 'outgoing-ringing' ? 'no-answer' : 'remote-hangup';
    default:
      return null;
  }
}

export function callReducer(state: CallState, action: CallAction): CallState {
  const nextPhase = TRANSITIONS[state.phase][action.type];
  if (!nextPhase) return state; // illegal transition — ignore

  const next: CallState = {
    ...state,
    phase: nextPhase,
    endReason: null,
    failReason: null,
    failDetail: null,
  };

  switch (action.type) {
    case 'DIAL':
    case 'CALL_CREATED':
    case 'INCOMING':
      next.callId = action.callId ?? state.callId;
      break;
    case 'RETRY':
      // Keep the previous callId for context; startCall() overwrites it.
      break;
    case 'DISMISS':
      next.callId = null;
      break;
    case 'FAIL':
      next.failReason = action.reason;
      next.failDetail = action.detail ?? null;
      break;
    case 'REMOTE_FAILED':
      next.failReason = 'remote-failed';
      next.failDetail = action.detail ?? null;
      break;
    default:
      break;
  }

  if (nextPhase === 'ended') {
    next.endReason = endReasonFor(action, state.phase);
  }
  if (nextPhase === 'dialing' && action.type === 'RETRY') {
    next.callId = null;
  }
  return next;
}

/** Active = the user is (or is about to be) on a call. */
export function isCallActive(phase: CallPhase): boolean {
  return (
    phase === 'dialing' ||
    phase === 'outgoing-ringing' ||
    phase === 'incoming-ringing' ||
    phase === 'connecting' ||
    phase === 'connected' ||
    phase === 'reconnecting'
  );
}

export function isTerminal(phase: CallPhase): boolean {
  return phase === 'ended' || phase === 'failed';
}
