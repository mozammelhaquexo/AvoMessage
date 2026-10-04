/**
 * lib/webrtc — WebRTC audio calling.
 *
 * callMachine: pure state machine (unit-tested).
 * useWebRTC:   P2P audio-call hook over Socket.io signaling (1:1 + ≤6 mesh).
 * calls-api:   participant-scoped REST helpers (initiate/read/transition/history).
 * ice-config:  RTCConfiguration from NEXT_PUBLIC_* env.
 */
export {
  callReducer,
  initialCallState,
  isCallActive,
  isTerminal,
  type CallAction,
  type CallEndReason,
  type CallFailReason,
  type CallPhase,
  type CallState,
} from './callMachine';
export { useWebRTC, type UseWebRTC, type UseWebRTCOptions, type RemoteAudio, type CallQuality, type IncomingCallMeta } from './useWebRTC';
export { buildIceConfig, readIceSettings, hasTurnRelay, type IceSettings } from './ice-config';
export {
  initiateCallRest,
  getCallRest,
  transitionCallRest,
  fetchCallHistory,
  type CallView,
  type InitiateCallInput,
  type CallTransitionAction,
  type CallHistoryPage,
} from './calls-api';
