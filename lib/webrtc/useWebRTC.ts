/**
 * lib/webrtc/useWebRTC.ts — P2P audio-call hook over Socket.io signaling.
 *
 * Implements the client half of the call flow (SPEC §"Audio calls"):
 *   idle → dialing → outgoing-ringing → connecting → connected
 *   idle → incoming-ringing → connecting → connected
 * with reconnect (ICE restart), quality monitoring, mute, timer, and cleanup.
 *
 * Signaling events used (see `lib/realtime/events.ts` — never hand-written):
 *   out: call:join/leave, call:ring, call:accept, call:reject,
 *        call:offer, call:answer, call:ice-candidate, call:hangup, call:failed
 *   in:  call:offer, call:answer, call:ice-candidate, call:accepted,
 *        call:rejected, call:ended, call:failed,
 *        call:participant-joined, call:participant-left
 *
 * Topology: full-mesh P2P. 1:1 is the primary path; group calls (≤6,
 * enforced server-side) open one RTCPeerConnection per remote peer and the
 * initiator offers to each peer as they accept (`call:accepted`). SDP/ICE
 * are relayed only — never persisted (server relays after a participation
 * check).
 *
 * Persistence: call records + status transitions are written by the
 * realtime server (`lib/realtime/server.ts`) and the REST service
 * (`lib/services/calls.ts`) — this hook never writes call metadata itself;
 * it only signals and reads via the participant-scoped REST endpoints.
 *
 * The call room is joined through the socket provider's reference-counted
 * `joinRoom`, so a socket reconnect re-subscribes us automatically.
 */
'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { useSocket, useRealtimeEvent } from '@/lib/realtime/client';
import {
  ClientToServer,
  ServerToClient,
  roomCall,
  type CallIncomingPayload,
} from '@/lib/realtime/events';
import {
  callReducer,
  initialCallState,
  isCallActive,
  type CallFailReason,
  type CallState,
} from './callMachine';
import { buildIceConfig } from './ice-config';
import {
  initiateCallRest,
  getCallRest,
  transitionCallRest,
  type CallView,
  type InitiateCallInput,
} from './calls-api';
import { mapMicError } from '@/lib/voice/recorder';

export type { CallState };
export type CallQuality = 'good' | 'fair' | 'poor' | 'unknown';

export interface RemoteAudio {
  userId: string;
  stream: MediaStream;
}

export interface UseWebRTCOptions {
  currentUserId: string;
  /** Stats polling interval for the quality indicator (default 5s). */
  statsIntervalMs?: number;
  /** ICE restarts before the call is marked failed (default 2). */
  maxIceRestarts?: number;
}

/** Incoming-call metadata handed to `acceptIncoming` / `rejectIncoming`. */
export type IncomingCallMeta = CallIncomingPayload;

interface OfferSignal { callId: string; from: string; sdp: RTCSessionDescriptionInit }
interface AnswerSignal { callId: string; from: string; sdp: RTCSessionDescriptionInit }
interface IceSignal { callId: string; from: string; candidate: RTCIceCandidateInit }
interface AcceptedSignal { callId: string; userId: string }
interface RejectedSignal { callId: string; userId: string }
interface EndedSignal { callId: string; reason: string }
interface FailedSignal { callId: string; reason: string }
interface ParticipantSignal { callId: string; userId: string }

interface PeerCtx {
  pc: RTCPeerConnection;
  restartCount: number;
  makingOffer: boolean;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  iceConnected: boolean;
}

type EmitFn = (
  event: string,
  payload: Record<string, unknown>,
  ack?: (res: { ok?: boolean; code?: string }) => void,
) => void;

const ACK_TIMEOUT_MS = 10_000;
const DISCONNECT_GRACE_MS = 10_000;
const REOFFER_WAIT_MS = 20_000;

export interface UseWebRTC {
  state: CallState;
  /** Full call record (participants, initiator) — null until created/fetched. */
  call: CallView | null;
  isInitiator: boolean;
  remoteAudios: RemoteAudio[];
  isMuted: boolean;
  quality: CallQuality;
  elapsedSec: number;
  startCall: (input: InitiateCallInput) => Promise<void>;
  /** Register an incoming call for display; returns false when busy. */
  notifyIncoming: (meta: IncomingCallMeta) => boolean;
  acceptIncoming: (meta: IncomingCallMeta) => Promise<void>;
  rejectIncoming: (callId: string) => Promise<void>;
  hangup: () => Promise<void>;
  toggleMute: () => void;
  retry: () => Promise<void>;
  reset: () => void;
}

export function useWebRTC(options: UseWebRTCOptions): UseWebRTC {
  const { currentUserId, statsIntervalMs = 5_000, maxIceRestarts = 2 } = options;
  const { socket, joinRoom, leaveRoom } = useSocket();

  const [callState, dispatch] = useReducer(callReducer, initialCallState);
  const [call, setCall] = useState<CallView | null>(null);
  const [isInitiator, setIsInitiator] = useState(false);
  const [remoteAudios, setRemoteAudios] = useState<RemoteAudio[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [quality, setQuality] = useState<CallQuality>('unknown');
  const [elapsedSec, setElapsedSec] = useState(0);

  // "Latest value" refs. The socket handlers and memoised callbacks below are
  // created once but must observe current values, so the mirror is written from
  // an effect. Assigning during render is a React Compiler violation and can
  // tear under concurrent rendering.
  const socketRef = useRef<Socket | null>(socket);
  const joinRoomRef = useRef(joinRoom);
  const leaveRoomRef = useRef(leaveRoom);
  const stateRef = useRef(callState);
  const callRef = useRef<CallView | null>(call);
  const isInitiatorRef = useRef(isInitiator);

  useEffect(() => {
    socketRef.current = socket;
    joinRoomRef.current = joinRoom;
    leaveRoomRef.current = leaveRoom;
    stateRef.current = callState;
    callRef.current = call;
    isInitiatorRef.current = isInitiator;
  }, [socket, joinRoom, leaveRoom, callState, call, isInitiator]);

  const peers = useRef(new Map<string, PeerCtx>());
  const localStream = useRef<MediaStream | null>(null);
  const lastInput = useRef<InitiateCallInput | null>(null);
  const connectedAt = useRef<number | null>(null);
  const timerId = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsId = useRef<ReturnType<typeof setInterval> | null>(null);
  const roomRef = useRef<string | null>(null);
  const failNotified = useRef(false);

  // ── helpers ────────────────────────────────────────────────────────

  /** Socket emit with ack + timeout. Rejects when the socket is down. */
  const emitAck = useCallback(
    (event: string, payload: Record<string, unknown>): Promise<void> =>
      new Promise((resolve, reject) => {
        const s = socketRef.current;
        if (!s || !s.connected) {
          reject(new Error('Realtime connection unavailable'));
          return;
        }
        let done = false;
        const timer = setTimeout(() => {
          if (!done) {
            done = true;
            reject(new Error('Signaling timed out'));
          }
        }, ACK_TIMEOUT_MS);
        (s.emit as EmitFn)(event, payload, (res) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (res && res.ok === false) reject(new Error(res.code ?? 'signal-rejected'));
          else resolve();
        });
      }),
    [],
  );

  const fireAndForget = useCallback((event: string, payload: Record<string, unknown>) => {
    try {
      (socketRef.current?.emit as EmitFn | undefined)?.(event, payload);
    } catch {
      /* best effort */
    }
  }, []);

  const stopLocalStream = useCallback(() => {
    if (localStream.current) {
      for (const t of localStream.current.getTracks()) t.stop();
      localStream.current = null;
    }
  }, []);

  /** Full teardown of media + peers + timers (does NOT change call state). */
  const teardownMedia = useCallback(() => {
    if (timerId.current) {
      clearInterval(timerId.current);
      timerId.current = null;
    }
    if (statsId.current) {
      clearInterval(statsId.current);
      statsId.current = null;
    }
    connectedAt.current = null;
    for (const [, peer] of peers.current) {
      if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
      try {
        peer.pc.close();
      } catch {
        /* noop */
      }
    }
    peers.current.clear();
    stopLocalStream();
    setRemoteAudios([]);
    setIsMuted(false);
    setQuality('unknown');
    setElapsedSec(0);
    if (roomRef.current) {
      leaveRoomRef.current(roomRef.current);
      roomRef.current = null;
    }
  }, [stopLocalStream]);

  const failCall = useCallback(
    (reason: CallFailReason, detail?: string) => {
      const id = stateRef.current.callId;
      if (!failNotified.current && id && isCallActive(stateRef.current.phase)) {
        failNotified.current = true;
        fireAndForget(ClientToServer.CALL_FAILED, { callId: id, reason });
      }
      teardownMedia();
      dispatch({ type: 'FAIL', reason, detail });
    },
    [fireAndForget, teardownMedia],
  );

  const endCallLocal = useCallback(
    (action: { type: 'HANGUP_LOCAL' } | { type: 'REJECT_LOCAL' }) => {
      teardownMedia();
      dispatch(action);
    },
    [teardownMedia],
  );

  const ensureLocalStream = useCallback(async (): Promise<MediaStream> => {
    if (localStream.current) return localStream.current;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      throw mapMicError(err);
    }
    localStream.current = stream;
    if (isMuted) {
      for (const t of stream.getAudioTracks()) t.enabled = false;
    }
    // Attach to any already-created peer connections.
    for (const [, peer] of peers.current) {
      for (const track of stream.getTracks()) {
        if (!peer.pc.getSenders().some((s) => s.track === track)) {
          peer.pc.addTrack(track, stream);
        }
      }
    }
    return stream;
  }, [isMuted]);

  // ── peer management ────────────────────────────────────────────────

  const updateQuality = useCallback(async () => {
    let worst: CallQuality = 'good';
    let seen = false;
    for (const [, peer] of peers.current) {
      let stats: RTCStatsReport;
      try {
        stats = await peer.pc.getStats();
      } catch {
        continue;
      }
      let rtt: number | null = null;
      let lost = 0;
      let received = 0;
      stats.forEach((report) => {
        if (
          report.type === 'candidate-pair' &&
          (report as unknown as { nominated?: boolean }).nominated &&
          (report as unknown as { state?: string }).state === 'succeeded'
        ) {
          const r = (report as unknown as { currentRoundTripTime?: number })
            .currentRoundTripTime;
          if (typeof r === 'number') rtt = rtt == null ? r : Math.max(rtt, r);
        }
        if (report.type === 'inbound-rtp') {
          const r = report as unknown as {
            packetsLost?: number;
            packetsReceived?: number;
          };
          lost += r.packetsLost ?? 0;
          received += r.packetsReceived ?? 0;
        }
      });
      seen = true;
      const loss = lost + received > 0 ? lost / (lost + received) : 0;
      const q: CallQuality =
        (rtt != null && rtt > 0.4) || loss > 0.05
          ? 'poor'
          : (rtt != null && rtt > 0.15) || loss > 0.02
            ? 'fair'
            : 'good';
      if (q === 'poor') worst = 'poor';
      else if (q === 'fair' && worst === 'good') worst = 'fair';
    }
    setQuality(seen ? worst : 'unknown');
  }, []);

  const startTimers = useCallback(() => {
    connectedAt.current = Date.now();
    if (timerId.current) clearInterval(timerId.current);
    timerId.current = setInterval(() => {
      if (connectedAt.current) {
        setElapsedSec(Math.floor((Date.now() - connectedAt.current) / 1000));
      }
    }, 1000);
    if (statsId.current) clearInterval(statsId.current);
    statsId.current = setInterval(() => {
      void updateQuality();
    }, statsIntervalMs);
    void updateQuality();
  }, [statsIntervalMs, updateQuality]);

  const markPeerConnected = useCallback(
    (peerId: string) => {
      const peer = peers.current.get(peerId);
      if (peer) {
        peer.iceConnected = true;
        if (peer.disconnectTimer) {
          clearTimeout(peer.disconnectTimer);
          peer.disconnectTimer = null;
        }
      }
      const phase = stateRef.current.phase;
      if (phase === 'connecting' || phase === 'reconnecting') {
        dispatch({ type: phase === 'reconnecting' ? 'ICE_RESTORED' : 'MEDIA_CONNECTED' });
        startTimers();
      }
    },
    [startTimers],
  );

  const attemptIceRestart = useCallback(
    (peerId: string) => {
      const peer = peers.current.get(peerId);
      const callId = stateRef.current.callId;
      if (!peer || !callId) return;
      if (!isCallActive(stateRef.current.phase)) return;

      dispatch({ type: 'ICE_RESTARTING' });

      if (isInitiatorRef.current) {
        // Only the initiator re-offers — avoids SDP glare.
        peer.restartCount += 1;
        if (peer.restartCount > maxIceRestarts) {
          failCall('ice-failed', 'The connection kept dropping. Check your network and try again.');
          return;
        }
        void (async () => {
          try {
            peer.makingOffer = true;
            const offer = await peer.pc.createOffer({ iceRestart: true });
            await peer.pc.setLocalDescription(offer);
            await emitAck(ClientToServer.CALL_OFFER, {
              callId,
              to: peerId,
              sdp: peer.pc.localDescription?.toJSON() ?? offer,
            });
          } catch {
            failCall('ice-failed', 'Could not re-establish the connection.');
          } finally {
            peer.makingOffer = false;
          }
        })();
      } else {
        // Non-initiator waits for the re-offer; give up after a grace period.
        if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
        peer.disconnectTimer = setTimeout(() => {
          if (stateRef.current.phase === 'reconnecting') {
            failCall('ice-failed', 'The connection dropped and could not be restored.');
          }
        }, REOFFER_WAIT_MS);
      }
    },
    [emitAck, failCall, maxIceRestarts],
  );

  const onIceStateChange = useCallback(
    (peerId: string) => {
      const peer = peers.current.get(peerId);
      if (!peer) return;
      const st = peer.pc.iceConnectionState;
      if (st === 'connected' || st === 'completed') {
        markPeerConnected(peerId);
      } else if (st === 'failed') {
        attemptIceRestart(peerId);
      } else if (st === 'disconnected') {
        if (!peer.disconnectTimer) {
          peer.disconnectTimer = setTimeout(() => {
            peer.disconnectTimer = null;
            const p = peers.current.get(peerId);
            if (
              p &&
              (p.pc.iceConnectionState === 'disconnected' ||
                p.pc.iceConnectionState === 'failed')
            ) {
              attemptIceRestart(peerId);
            }
          }, DISCONNECT_GRACE_MS);
        }
      }
    },
    [attemptIceRestart, markPeerConnected],
  );

  const ensurePeer = useCallback(
    (peerId: string): RTCPeerConnection | null => {
      const existing = peers.current.get(peerId);
      if (existing) return existing.pc;
      if (typeof RTCPeerConnection === 'undefined') return null;
      const pc = new RTCPeerConnection(buildIceConfig());
      const ctx: PeerCtx = {
        pc,
        restartCount: 0,
        makingOffer: false,
        disconnectTimer: null,
        iceConnected: false,
      };
      peers.current.set(peerId, ctx);

      pc.onicecandidate = (e) => {
        const callId = stateRef.current.callId;
        if (e.candidate && callId) {
          fireAndForget(ClientToServer.CALL_ICE_CANDIDATE, {
            callId,
            to: peerId,
            candidate: e.candidate.toJSON(),
          });
        }
      };
      pc.ontrack = (e) => {
        const stream = e.streams[0];
        if (!stream) return;
        setRemoteAudios((prev) => {
          const others = prev.filter((r) => r.userId !== peerId);
          return [...others, { userId: peerId, stream }];
        });
      };
      pc.oniceconnectionstatechange = () => onIceStateChange(peerId);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') attemptIceRestart(peerId);
        if (pc.connectionState === 'connected') markPeerConnected(peerId);
      };

      // Attach local tracks if we already have the mic.
      const ls = localStream.current;
      if (ls) {
        for (const track of ls.getTracks()) pc.addTrack(track, ls);
      }
      return pc;
    },
    [attemptIceRestart, fireAndForget, markPeerConnected, onIceStateChange],
  );

  const removePeer = useCallback((peerId: string) => {
    const peer = peers.current.get(peerId);
    if (peer) {
      if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
      try {
        peer.pc.close();
      } catch {
        /* noop */
      }
      peers.current.delete(peerId);
    }
    setRemoteAudios((prev) => prev.filter((r) => r.userId !== peerId));
  }, []);

  // ── public actions ─────────────────────────────────────────────────

  /** Initiate an outgoing call: REST creates the record, socket rings. */
  const startCall = useCallback(
    async (input: InitiateCallInput) => {
      if (isCallActive(stateRef.current.phase)) return;
      dispatch({ type: 'DIAL' });
      failNotified.current = false;
      lastInput.current = input;

      try {
        if (typeof RTCPeerConnection === 'undefined') {
          throw { failReason: 'unsupported' as CallFailReason, detail: 'This browser doesn’t support calls. Use a recent Chrome, Edge, Firefox or Safari.' };
        }
        const others = input.userIds ?? [];
        if (others.length > 5) {
          throw { failReason: 'signaling-error' as CallFailReason, detail: 'Group calls are capped at 6 participants.' };
        }
        const { call: created } = await initiateCallRest(input);
        setCall(created);
        setIsInitiator(true);
        isInitiatorRef.current = true;
        dispatch({ type: 'CALL_CREATED', callId: created.id });

        const room = roomCall(created.id);
        joinRoomRef.current(room);
        roomRef.current = room;

        // Re-ring the freshly created call → server emits `call:incoming`
        // to every other participant's `user:{id}` room.
        await emitAck(ClientToServer.CALL_RING, { callId: created.id });
      } catch (err) {
        const micErr = (err as { code?: string })?.code;
        if (micErr && typeof micErr === 'string' && ['permission-denied','no-microphone','device-in-use','overconstrained','aborted','not-supported','too-long','unknown'].includes(micErr)) {
          failCall('media-unavailable', (err as { title?: string }).title ?? 'Could not access the microphone.');
        } else if ((err as { failReason?: CallFailReason })?.failReason) {
          const e = err as { failReason: CallFailReason; detail?: string };
          failCall(e.failReason, e.detail);
        } else {
          const msg = err instanceof Error ? err.message : 'Could not start the call.';
          failCall('signaling-error', msg);
        }
      }
    },
    [emitAck, failCall],
  );

  /**
   * Register an incoming call for display. Returns false when we're already
   * on a call — the caller should auto-decline (busy) in that case.
   */
  const notifyIncoming = useCallback((meta: IncomingCallMeta) => {
    const phase = stateRef.current.phase;
    if (phase === 'idle' || phase === 'ended' || phase === 'failed') {
      dispatch({ type: 'INCOMING', callId: meta.callId });
      return true;
    }
    return false;
  }, []);

  /** Accept an incoming call (from the CallProvider's incoming UI). */
  const acceptIncoming = useCallback(
    async (meta: IncomingCallMeta) => {
      let phase = stateRef.current.phase;
      if (phase === 'idle' || phase === 'ended' || phase === 'failed') {
        dispatch({ type: 'INCOMING', callId: meta.callId });
        phase = 'incoming-ringing';
      }
      if (phase !== 'incoming-ringing') return;
      dispatch({ type: 'ACCEPT_LOCAL' });
      failNotified.current = false;
      try {
        if (typeof RTCPeerConnection === 'undefined') {
          throw { failReason: 'unsupported' as CallFailReason, detail: 'This browser doesn’t support calls.' };
        }
        const stream = await ensureLocalStream();
        void stream;
        // Load the full call record (participant list for the mesh + UI).
        try {
          const { call: full } = await getCallRest(meta.callId);
          setCall(full);
        } catch {
          /* non-fatal: UI can render from the incoming payload */
        }
        setIsInitiator(false);
        isInitiatorRef.current = false;
        const room = roomCall(meta.callId);
        joinRoomRef.current(room);
        roomRef.current = room;
        await emitAck(ClientToServer.CALL_ACCEPT, { callId: meta.callId });
        // The initiator offers; we answer when `call:offer` arrives.
      } catch (err) {
        const micErr = (err as { code?: string })?.code;
        if (typeof micErr === 'string') {
          const mapped = err as { title?: string; hint?: string };
          failCall('media-denied', `${mapped.title ?? 'Microphone unavailable.'} ${mapped.hint ?? ''}`.trim());
        } else if ((err as { failReason?: CallFailReason })?.failReason) {
          const e = err as { failReason: CallFailReason; detail?: string };
          failCall(e.failReason, e.detail);
        } else {
          failCall('signaling-error', err instanceof Error ? err.message : 'Could not accept the call.');
        }
        // Tell the caller we can't connect rather than leaving them ringing.
        fireAndForget(ClientToServer.CALL_FAILED, {
          callId: meta.callId,
          reason: 'callee-media-unavailable',
        });
      }
    },
    [emitAck, ensureLocalStream, failCall, fireAndForget],
  );

  /** Decline an incoming call we haven't joined yet. */
  const rejectIncoming = useCallback(
    async (callId: string) => {
      try {
        await emitAck(ClientToServer.CALL_REJECT, { callId });
      } catch {
        // Socket down — persist the decline via REST so history is correct.
        try {
          await transitionCallRest(callId, 'decline');
        } catch {
          /* best effort */
        }
      }
      dispatch({ type: 'REJECT_LOCAL' });
    },
    [emitAck],
  );

  /** Hang up the active call. */
  const hangup = useCallback(async () => {
    const id = stateRef.current.callId;
    if (!id || !isCallActive(stateRef.current.phase)) {
      teardownMedia();
      dispatch({ type: 'DISMISS' });
      return;
    }
    endCallLocal({ type: 'HANGUP_LOCAL' });
    try {
      await emitAck(ClientToServer.CALL_HANGUP, { callId: id });
    } catch {
      // Socket down — persist ENDED via REST so history isn't stuck.
      try {
        await transitionCallRest(id, 'end');
      } catch {
        /* best effort */
      }
    }
  }, [emitAck, endCallLocal, teardownMedia]);

  const toggleMute = useCallback(() => {
    const stream = localStream.current;
    const next = !isMuted;
    if (stream) {
      for (const t of stream.getAudioTracks()) t.enabled = !next;
    }
    setIsMuted(next);
  }, [isMuted]);

  /** Redial the last call after a failure / no-answer. */
  const retry = useCallback(async () => {
    const input = lastInput.current;
    dispatch({ type: 'RETRY' });
    teardownMedia();
    setCall(null);
    if (input) {
      await startCall(input);
    }
  }, [startCall, teardownMedia]);

  const reset = useCallback(() => {
    teardownMedia();
    setCall(null);
    setIsInitiator(false);
    isInitiatorRef.current = false;
    lastInput.current = null;
    failNotified.current = false;
    dispatch({ type: 'DISMISS' });
  }, [teardownMedia]);

  // ── incoming signaling ───────────────────────────────────────────

  const handleOffer = useCallback(
    async (payload: OfferSignal) => {
      const callId = stateRef.current.callId;
      if (!callId || payload.callId !== callId) return;
      const phase = stateRef.current.phase;
      if (!isCallActive(phase) || phase === 'outgoing-ringing') return;
      const pc = ensurePeer(payload.from);
      if (!pc) {
        failCall('unsupported', 'This browser doesn’t support calls.');
        return;
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await emitAck(ClientToServer.CALL_ANSWER, {
          callId,
          to: payload.from,
          sdp: pc.localDescription?.toJSON() ?? answer,
        });
      } catch {
        failCall('signaling-error', 'Failed to negotiate the connection.');
      }
    },
    [emitAck, ensurePeer, failCall],
  );

  const handleAnswer = useCallback(
    async (payload: AnswerSignal) => {
      const callId = stateRef.current.callId;
      if (!callId || payload.callId !== callId) return;
      const peer = peers.current.get(payload.from);
      if (!peer) return;
      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      } catch {
        failCall('signaling-error', 'Failed to negotiate the connection.');
      }
    },
    [failCall],
  );

  const handleIce = useCallback((payload: IceSignal) => {
    const callId = stateRef.current.callId;
    if (!callId || payload.callId !== callId || !payload.candidate) return;
    const peer = peers.current.get(payload.from);
    if (!peer) return;
    void peer.pc
      .addIceCandidate(new RTCIceCandidate(payload.candidate))
      .catch(() => undefined);
  }, []);

  const handleAccepted = useCallback(
    (payload: AcceptedSignal) => {
      const callId = stateRef.current.callId;
      if (!callId || payload.callId !== callId) return;
      if (payload.userId === currentUserId) return;
      if (!isInitiatorRef.current) return;
      if (stateRef.current.phase !== 'outgoing-ringing') return;
      dispatch({ type: 'ACCEPTED_REMOTE' });
      void (async () => {
        try {
          // Mic for the caller is acquired at offer time (not while ringing).
          await ensureLocalStream();
          const pc = ensurePeer(payload.userId);
          if (!pc) {
            failCall('unsupported', 'This browser doesn’t support calls.');
            return;
          }
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await emitAck(ClientToServer.CALL_OFFER, {
            callId,
            to: payload.userId,
            sdp: pc.localDescription?.toJSON() ?? offer,
          });
        } catch (err) {
          const micErr = (err as { code?: string })?.code;
          failCall(
            typeof micErr === 'string' ? 'media-denied' : 'signaling-error',
            err instanceof Error ? err.message : 'Could not set up audio.',
          );
          fireAndForget(ClientToServer.CALL_FAILED, { callId, reason: 'caller-media-failed' });
        }
      })();
    },
    [currentUserId, emitAck, ensureLocalStream, ensurePeer, failCall, fireAndForget],
  );

  const handleRejected = useCallback(
    (payload: RejectedSignal) => {
      const callId = stateRef.current.callId;
      if (!callId || payload.callId !== callId) return;
      if (payload.userId === currentUserId) return;
      const participantCount = callRef.current?.participants.length ?? 2;
      if (participantCount <= 2) {
        // 1:1 — a decline ends the call.
        teardownMedia();
        dispatch({ type: 'REJECTED_REMOTE' });
      } else {
        // Group — the decliner just leaves the mesh.
        removePeer(payload.userId);
      }
    },
    [currentUserId, removePeer, teardownMedia],
  );

  const handleEnded = useCallback(
    (payload: EndedSignal) => {
      const callId = stateRef.current.callId;
      if (!callId || payload.callId !== callId) return;
      const phase = stateRef.current.phase;
      teardownMedia();
      if (payload.reason === 'missed') {
        dispatch({ type: phase === 'outgoing-ringing' ? 'NO_ANSWER' : 'MISSED' });
      } else {
        dispatch({ type: 'ENDED_REMOTE' });
      }
    },
    [teardownMedia],
  );

  const handleFailed = useCallback(
    (payload: FailedSignal) => {
      const callId = stateRef.current.callId;
      if (!callId || payload.callId !== callId) return;
      if (failNotified.current) return; // we reported it ourselves
      teardownMedia();
      dispatch({ type: 'REMOTE_FAILED', detail: payload.reason });
    },
    [teardownMedia],
  );

  const handleParticipantLeft = useCallback(
    (payload: ParticipantSignal) => {
      const callId = stateRef.current.callId;
      if (!callId || payload.callId !== callId) return;
      if (payload.userId === currentUserId) return;
      removePeer(payload.userId);
    },
    [currentUserId, removePeer],
  );

  useRealtimeEvent(ServerToClient.CALL_OFFER, (p: OfferSignal) => void handleOffer(p));
  useRealtimeEvent(ServerToClient.CALL_ANSWER, (p: AnswerSignal) => void handleAnswer(p));
  useRealtimeEvent(ServerToClient.CALL_ICE_CANDIDATE, (p: IceSignal) => handleIce(p));
  useRealtimeEvent(ServerToClient.CALL_ACCEPTED, (p: AcceptedSignal) => handleAccepted(p));
  useRealtimeEvent(ServerToClient.CALL_REJECTED, (p: RejectedSignal) => handleRejected(p));
  useRealtimeEvent(ServerToClient.CALL_ENDED, (p: EndedSignal) => handleEnded(p));
  useRealtimeEvent(ServerToClient.CALL_FAILED, (p: FailedSignal) => handleFailed(p));
  useRealtimeEvent(ServerToClient.CALL_PARTICIPANT_LEFT, (p: ParticipantSignal) =>
    handleParticipantLeft(p),
  );

  // ── unmount: best-effort hangup + full cleanup ────────────────────
  useEffect(() => {
    const s = socketRef.current;
    return () => {
      const st = stateRef.current;
      if (st.callId && isCallActive(st.phase)) {
        try {
          (s?.emit as EmitFn | undefined)?.(ClientToServer.CALL_HANGUP, {
            callId: st.callId,
          });
        } catch {
          /* page is going away */
        }
      }
      if (roomRef.current) {
        try {
          leaveRoomRef.current(roomRef.current);
        } catch {
          /* noop */
        }
      }
      // The cleanup must close every peer that exists at unmount time, so
      // reading the live ref here (rather than a value captured at mount) is
      // intentional.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      for (const [, peer] of peers.current) {
        if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
        try {
          peer.pc.close();
        } catch {
          /* noop */
        }
      }
      peers.current.clear();
      if (timerId.current) clearInterval(timerId.current);
      if (statsId.current) clearInterval(statsId.current);
      const ls = localStream.current;
      if (ls) for (const t of ls.getTracks()) t.stop();
    };
  }, []);

  const value = useMemo<UseWebRTC>(
    () => ({
      state: callState,
      call,
      isInitiator,
      remoteAudios,
      isMuted,
      quality,
      elapsedSec,
      startCall,
      notifyIncoming,
      acceptIncoming,
      rejectIncoming,
      hangup,
      toggleMute,
      retry,
      reset,
    }),
    [
      callState,
      call,
      isInitiator,
      remoteAudios,
      isMuted,
      quality,
      elapsedSec,
      startCall,
      notifyIncoming,
      acceptIncoming,
      rejectIncoming,
      hangup,
      toggleMute,
      retry,
      reset,
    ],
  );

  return value;
}
