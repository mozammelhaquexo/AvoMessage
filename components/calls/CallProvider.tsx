/**
 * components/calls/CallProvider.tsx — global call orchestration.
 *
 * Mount ONCE near the root of the authenticated app, inside `SocketProvider`:
 *
 *   <SocketProvider>
 *     <CallProvider currentUser={{ id, name, avatarUrl }}>
 *       {children}
 *     </CallProvider>
 *   </SocketProvider>
 *
 * Responsibilities:
 * - listens for `call:incoming` on the caller's `user:{id}` room and shows
 *   the incoming-call UI (auto-declines with "busy" when already on a call);
 * - owns the single `useWebRTC` instance and renders `CallWindow` (or its
 *   minimized pill) whenever a call is active;
 * - exposes `useCall()` → `{ rtc, incoming, startCall, accept, reject, … }`
 *   so message threads / profiles can start calls and pages can render
 *   `CallHistory` with a working redial.
 *
 * Privacy: incoming payloads carry only the caller's public profile
 * (id/name/avatar); full call records are fetched through the
 * participant-scoped `GET /api/calls/:id`.
 */
'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useSocket, useRealtimeEvent } from '@/lib/realtime/client';
import {
  ClientToServer,
  ServerToClient,
  type CallIncomingPayload,
} from '@/lib/realtime/events';
import { toast } from '@/components/ui';
import {
  useWebRTC,
  type IncomingCallMeta,
  type UseWebRTC,
} from '@/lib/webrtc/useWebRTC';
import type { InitiateCallInput } from '@/lib/webrtc/calls-api';
import { CallWindow, type CallPeerDisplay, type CallWindowMode } from './CallWindow';

export interface CallCurrentUser {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface CallContextValue {
  rtc: UseWebRTC;
  /** Pending incoming call (ringing UI visible). Null when none. */
  incoming: IncomingCallMeta | null;
  minimized: boolean;
  setMinimized: (v: boolean) => void;
  startCall: (input: InitiateCallInput) => Promise<void>;
  accept: () => Promise<void>;
  reject: () => Promise<void>;
}

const CallContext = createContext<CallContextValue | null>(null);

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall() must be used inside <CallProvider>');
  return ctx;
}

const ENDED_TOAST: Record<string, string> = {
  'hung-up': 'Call ended',
  'declined-local': 'Call declined',
  'declined-remote': 'Call declined',
  'missed': 'Missed call',
  'no-answer': 'No answer',
  'busy': 'Declined — already on a call',
  'remote-hangup': 'Call ended',
};

export function CallProvider({
  currentUser,
  children,
}: {
  currentUser: CallCurrentUser;
  children: ReactNode;
}) {
  const { socket } = useSocket();
  const rtc = useWebRTC({ currentUserId: currentUser.id });
  const [incoming, setIncoming] = useState<IncomingCallMeta | null>(null);
  const [minimized, setMinimized] = useState(false);
  const incomingRef = useRef<IncomingCallMeta | null>(null);
  const rtcRef = useRef(rtc);

  // Mirror the latest values for the socket handlers below, which are
  // registered once. Written from an effect rather than during render.
  useEffect(() => {
    incomingRef.current = incoming;
    rtcRef.current = rtc;
  }, [incoming, rtc]);

  // ── incoming calls ────────────────────────────────────────────────
  useRealtimeEvent(
    ServerToClient.CALL_INCOMING,
    (payload: CallIncomingPayload) => {
      if (!payload || typeof payload.callId !== 'string') return;
      if (payload.from === currentUser.id) return; // our own ring, echoed
      const r = rtcRef.current;
      const free = r.notifyIncoming(payload);
      if (!free) {
        // Busy: politely decline so the caller isn't left ringing.
        try {
          socket?.emit(ClientToServer.CALL_REJECT, { callId: payload.callId });
        } catch {
          /* best effort */
        }
        toast({ title: 'Missed call', description: `${payload.fromName ?? 'Someone'} called while you were on another call.`, variant: 'info' });
        return;
      }
      setIncoming(payload);
      setMinimized(false);
    },
  );

  // Clear the incoming banner when that call resolves elsewhere.
  const clearIncomingIf = useCallback((callId: string) => {
    setIncoming((prev) => (prev?.callId === callId ? null : prev));
  }, []);
  useRealtimeEvent(ServerToClient.CALL_ENDED, (p: { callId: string }) => {
    if (p?.callId) clearIncomingIf(p.callId);
  });
  useRealtimeEvent(ServerToClient.CALL_REJECTED, (p: { callId: string }) => {
    if (p?.callId) clearIncomingIf(p.callId);
  });
  useRealtimeEvent(ServerToClient.CALL_FAILED, (p: { callId: string }) => {
    if (p?.callId) clearIncomingIf(p.callId);
  });

  // When our own rtc call id changes away from the incoming one, drop it.
  useEffect(() => {
    const activeId = rtc.state.callId;
    if (incomingRef.current && activeId && incomingRef.current.callId !== activeId) {
      // We started/accepted a different call — the old banner is stale.
      setIncoming((prev) => (prev && prev.callId !== activeId ? null : prev));
    }
  }, [rtc.state.callId]);

  // Toast on terminal states, then reset to idle.
  const lastTerminal = useRef<string | null>(null);
  useEffect(() => {
    const { phase, endReason, callId } = rtc.state;
    const key = `${phase}:${callId ?? ''}`;
    if ((phase === 'ended' || phase === 'failed') && lastTerminal.current !== key) {
      lastTerminal.current = key;
      setIncoming(null);
      setMinimized(false);
      if (phase === 'ended' && endReason) {
        const label = ENDED_TOAST[endReason];
        if (label && endReason !== 'hung-up') toast({ title: label, variant: 'info' });
      }
      // 'failed' keeps the CallWindow up with Retry/Dismiss — no toast needed.
    }
    if (phase !== 'ended' && phase !== 'failed') lastTerminal.current = null;
  }, [rtc.state]);

  // ── actions ───────────────────────────────────────────────────────
  const startCall = useCallback(
    async (input: InitiateCallInput) => {
      setMinimized(false);
      await rtcRef.current.startCall(input);
    },
    [],
  );

  const accept = useCallback(async () => {
    const meta = incomingRef.current;
    if (!meta) return;
    setMinimized(false);
    await rtcRef.current.acceptIncoming(meta);
    setIncoming(null);
  }, []);

  const reject = useCallback(async () => {
    const meta = incomingRef.current;
    setIncoming(null);
    if (!meta) return;
    await rtcRef.current.rejectIncoming(meta.callId);
  }, []);

  // ── CallWindow view-model ─────────────────────────────────────────
  const { state, call } = rtc;
  let mode: CallWindowMode | null = null;
  if (state.phase === 'failed') mode = 'failed';
  else if (incoming && state.phase === 'incoming-ringing') mode = 'incoming';
  else if (state.phase === 'outgoing-ringing' || state.phase === 'dialing') mode = 'outgoing';
  else if (
    state.phase === 'connecting' ||
    state.phase === 'connected' ||
    state.phase === 'reconnecting'
  )
    mode = 'active';

  const others: CallPeerDisplay[] = (call?.participants ?? [])
    .filter((p) => p.user.id !== currentUser.id)
    .map((p) => ({ userId: p.user.id, name: p.user.name, avatarUrl: p.user.avatarUrl }));

  let title = 'Call';
  let avatarUrl: string | null = null;
  let subtitle: string | undefined;
  if (mode === 'incoming' && incoming) {
    title = incoming.fromName ?? 'Unknown caller';
    avatarUrl = incoming.fromAvatarUrl;
    subtitle = incoming.type === 'VIDEO' ? 'Incoming video call (audio only)' : 'Incoming audio call';
  } else if (others.length === 1) {
    title = others[0]!.name;
    avatarUrl = others[0]!.avatarUrl;
    subtitle = state.phase === 'connected' || state.phase === 'reconnecting' ? 'Audio call' : undefined;
  } else if (others.length > 1) {
    title = `Group call (${others.length + 1})`;
    subtitle = others.map((o) => o.name).slice(0, 3).join(', ');
  }

  const value: CallContextValue = {
    rtc,
    incoming,
    minimized,
    setMinimized,
    startCall,
    accept,
    reject,
  };

  return (
    <CallContext.Provider value={value}>
      {children}
      {mode && (
        <CallWindow
          mode={mode}
          title={title}
          subtitle={subtitle}
          avatarUrl={avatarUrl}
          peers={others}
          elapsedSec={rtc.elapsedSec}
          isMuted={rtc.isMuted}
          quality={rtc.quality}
          reconnecting={state.phase === 'reconnecting'}
          minimized={minimized}
          failDetail={state.failDetail}
          remoteAudios={rtc.remoteAudios}
          canRetry={state.failReason !== 'unsupported'}
          onAccept={() => void accept()}
          onReject={() => void reject()}
          onHangup={() => void rtc.hangup()}
          onToggleMute={rtc.toggleMute}
          onToggleMinimize={() => setMinimized((m) => !m)}
          onRetry={() => void rtc.retry()}
          onDismiss={rtc.reset}
        />
      )}
    </CallContext.Provider>
  );
}
