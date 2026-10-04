/**
 * components/calls/CallWindow.tsx — call UI overlay.
 *
 * Presentational: the CallProvider feeds it from `useWebRTC`. Modes:
 *   incoming — caller info, Accept / Reject, WebAudio ringtone (no assets)
 *   outgoing — "Ringing…", cancel
 *   active   — avatar(s), timer, mute, hangup, quality dot, minimize
 *   failed   — error detail, Retry, Dismiss
 *
 * Minimized mode collapses to a bottom-right pill so the user can keep
 * chatting during a call. All controls are real and keyboard-operable.
 */
'use client';

import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Avatar, Button, Icon } from '@/components/ui';
import { formatDuration } from '@/lib/voice/recorder';
import type { CallQuality, RemoteAudio } from '@/lib/webrtc/useWebRTC';

export type CallWindowMode = 'incoming' | 'outgoing' | 'active' | 'failed';

export interface CallPeerDisplay {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

export interface CallWindowProps {
  mode: CallWindowMode;
  /** Primary label: caller name, callee name, or "Group call". */
  title: string;
  subtitle?: string;
  avatarUrl?: string | null;
  /** Group peers for the avatar stack / participant count. */
  peers?: CallPeerDisplay[];
  elapsedSec?: number;
  isMuted?: boolean;
  quality?: CallQuality;
  /** ICE restart in progress — shown as "Reconnecting…". */
  reconnecting?: boolean;
  minimized?: boolean;
  /** Failure detail (already user-safe). */
  failDetail?: string | null;
  /** Terminal info, e.g. "Declined", "No answer", "Missed call". */
  endLabel?: string | null;
  remoteAudios?: RemoteAudio[];
  canRetry?: boolean;
  onAccept: () => void;
  onReject: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleMinimize: () => void;
  onRetry?: () => void;
  onDismiss: () => void;
}

/** WebAudio ringtone — dual-tone 1s-on/2s-off, no audio assets needed. */
function useRingtone(active: boolean): void {
  const ctxRef = useRef<AudioContext | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    stopRef.current = false;
    let disposed = false;

    const ensureCtx = (): AudioContext | null => {
      try {
        const Ctx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctx) return null;
        if (!ctxRef.current) ctxRef.current = new Ctx();
        return ctxRef.current;
      } catch {
        return null;
      }
    };

    const playPattern = async () => {
      const ctx = ensureCtx();
      if (!ctx || disposed || stopRef.current) return;
      // Browsers block AudioContext before a user gesture; wait for one.
      if (ctx.state === 'suspended') {
        const resume = () => {
          void ctx.resume().catch(() => undefined);
        };
        window.addEventListener('pointerdown', resume, { once: true });
        window.addEventListener('keydown', resume, { once: true });
        return;
      }
      const ringOnce = () => {
        if (disposed || stopRef.current || !ctxRef.current) return;
        const ctx = ctxRef.current;
        const t = ctx.currentTime;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.25, t + 0.05);
        gain.gain.setValueAtTime(0.25, t + 0.9);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
        for (const freq of [440, 480]) {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = freq;
          osc.connect(gain);
          osc.start(t);
          osc.stop(t + 1.05);
        }
        gain.connect(ctx.destination);
      };
      ringOnce();
      const id = setInterval(() => {
        if (disposed || stopRef.current) {
          clearInterval(id);
          return;
        }
        ringOnce();
      }, 3000);
      return () => clearInterval(id);
    };

    let cleanup: (() => void) | undefined;
    void playPattern().then((c) => {
      cleanup = c;
    });
    return () => {
      disposed = true;
      stopRef.current = true;
      cleanup?.();
      if (ctxRef.current) {
        void ctxRef.current.close().catch(() => undefined);
        ctxRef.current = null;
      }
    };
  }, [active]);
}

function QualityDot({ quality }: { quality: CallQuality }) {
  const map: Record<CallQuality, { cls: string; label: string }> = {
    good: { cls: 'bg-success', label: 'Good connection' },
    fair: { cls: 'bg-warning', label: 'Fair connection' },
    poor: { cls: 'bg-danger', label: 'Poor connection' },
    unknown: { cls: 'bg-offline', label: 'Measuring connection…' },
  };
  const { cls, label } = map[quality];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`}
    />
  );
}

function RemoteAudioEl({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.srcObject = stream;
    return () => {
      if (el) el.srcObject = null;
    };
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline />;
}

export function CallWindow(props: CallWindowProps) {
  const {
    mode,
    title,
    subtitle,
    avatarUrl,
    peers = [],
    elapsedSec = 0,
    isMuted = false,
    quality = 'unknown',
    reconnecting = false,
    minimized = false,
    failDetail,
    endLabel,
    remoteAudios = [],
    canRetry = false,
    onAccept,
    onReject,
    onHangup,
    onToggleMute,
    onToggleMinimize,
    onRetry,
    onDismiss,
  } = props;
  const reduceMotion = useReducedMotion();
  useRingtone(mode === 'incoming');

  // Escape: reject an incoming call, hang up an active one, dismiss otherwise.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (mode === 'incoming') onReject();
      else if (mode === 'active' || mode === 'outgoing') onHangup();
      else onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, onReject, onHangup, onDismiss]);

  const statusLine =
    mode === 'incoming'
      ? 'Incoming audio call…'
      : mode === 'outgoing'
        ? 'Ringing…'
        : reconnecting
          ? 'Reconnecting…'
          : formatDuration(elapsedSec * 1000);

  const shell =
    'fixed z-call flex flex-col items-center gap-4 rounded-lg border border-line bg-surface px-8 py-6 shadow-lg';

  // ── minimized pill ────────────────────────────────────────────────
  if (minimized && (mode === 'active' || mode === 'outgoing')) {
    return (
      <div
        role="dialog"
        aria-label={`Call with ${title}, ${statusLine}`}
        className="fixed bottom-4 right-4 z-call flex items-center gap-3 rounded-full border border-line bg-surface py-2 pl-3 pr-2 shadow-lg"
      >
        {remoteAudios.map((r) => (
          <RemoteAudioEl key={r.userId} stream={r.stream} />
        ))}
        <Avatar src={avatarUrl} name={title} size="sm" />
        <div className="min-w-0">
          <p className="max-w-32 truncate text-body-sm font-semibold text-ink">{title}</p>
          <p className="flex items-center gap-1.5 text-caption text-ink-2" aria-live="polite">
            <QualityDot quality={quality} />
            {statusLine}
          </p>
        </div>
        <Button
          size="icon-sm"
          variant={isMuted ? 'danger' : 'secondary'}
          aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          aria-pressed={isMuted}
          onClick={onToggleMute}
        >
          <Icon name={isMuted ? 'micOff' : 'mic'} className="h-4 w-4" aria-hidden />
        </Button>
        <Button size="icon-sm" variant="danger" aria-label="End call" onClick={onHangup}>
          <Icon name="phoneOff" className="h-4 w-4" aria-hidden />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Expand call window" onClick={onToggleMinimize}>
          <Icon name="chevronUp" className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    );
  }

  // ── failed ────────────────────────────────────────────────────────
  if (mode === 'failed') {
    return (
      <div role="alertdialog" aria-label="Call failed" className={`${shell} left-1/2 top-24 w-[min(92vw,380px)] -translate-x-1/2`}>
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-danger/10">
          <Icon name="phoneOff" className="h-6 w-6 text-danger-strong" aria-hidden />
        </span>
        <div className="text-center">
          <p className="text-h3 font-semibold text-ink">Call failed</p>
          {failDetail && <p className="mt-1 text-body-sm text-ink-2">{failDetail}</p>}
        </div>
        <div className="flex gap-2">
          {canRetry && onRetry && (
            <Button size="sm" onClick={onRetry}>
              <Icon name="refresh" className="h-4 w-4" aria-hidden />
              Try again
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    );
  }

  const isIncoming = mode === 'incoming';

  return (
    <div
      role="dialog"
      aria-label={isIncoming ? `Incoming call from ${title}` : `Call with ${title}`}
      className={`${shell} left-1/2 top-24 w-[min(92vw,380px)] -translate-x-1/2`}
    >
      {remoteAudios.map((r) => (
        <RemoteAudioEl key={r.userId} stream={r.stream} />
      ))}

      <div className="relative">
        {peers.length > 1 ? (
          <div className="flex -space-x-4" aria-hidden>
            {peers.slice(0, 3).map((p) => (
              <Avatar key={p.userId} src={p.avatarUrl} name={p.name} size="lg" className="ring-2 ring-surface" />
            ))}
          </div>
        ) : (
          <Avatar src={avatarUrl} name={title} size="xl" />
        )}
        {isIncoming && !reduceMotion && (
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-brand/20" />
        )}
      </div>

      <div className="text-center">
        <p className="text-h3 font-semibold text-ink">{title}</p>
        {subtitle && <p className="mt-0.5 text-body-sm text-ink-2">{subtitle}</p>}
        <p className="mt-1.5 flex items-center justify-center gap-1.5 text-body-sm text-ink-2" aria-live="polite">
          {mode === 'active' && <QualityDot quality={quality} />}
          {statusLine}
        </p>
        {endLabel && (
          <p role="status" className="mt-1 text-body-sm text-ink-3">
            {endLabel}
          </p>
        )}
      </div>

      {isIncoming ? (
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-center gap-1">
            <Button
              size="icon"
              variant="danger"
              autoFocus
              aria-label={`Decline call from ${title}`}
              onClick={onReject}
              className="h-14 w-14"
            >
              <Icon name="phoneOff" className="h-6 w-6" aria-hidden />
            </Button>
            <span className="text-caption text-ink-2">Decline</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Button
              size="icon"
              variant="success"
              aria-label={`Accept call from ${title}`}
              onClick={onAccept}
              className="h-14 w-14"
            >
              <Icon name="phone" className="h-6 w-6" aria-hidden />
            </Button>
            <span className="text-caption text-ink-2">Accept</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          {mode === 'active' && (
            <div className="flex flex-col items-center gap-1">
              <Button
                size="icon"
                variant={isMuted ? 'danger' : 'secondary'}
                aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                aria-pressed={isMuted}
                onClick={onToggleMute}
              >
                <Icon name={isMuted ? 'micOff' : 'mic'} className="h-5 w-5" aria-hidden />
              </Button>
              <span className="text-caption text-ink-2">{isMuted ? 'Unmute' : 'Mute'}</span>
            </div>
          )}
          <div className="flex flex-col items-center gap-1">
            <Button
              size="icon"
              variant="danger"
              aria-label={mode === 'outgoing' ? 'Cancel call' : 'End call'}
              onClick={onHangup}
              className="h-14 w-14"
            >
              <Icon name="phoneOff" className="h-6 w-6" aria-hidden />
            </Button>
            <span className="text-caption text-ink-2">
              {mode === 'outgoing' ? 'Cancel' : 'End'}
            </span>
          </div>
          {mode === 'active' && (
            <div className="flex flex-col items-center gap-1">
              <Button
                size="icon"
                variant="secondary"
                aria-label="Minimize call window"
                onClick={onToggleMinimize}
              >
                <Icon name="chevronDown" className="h-5 w-5" aria-hidden />
              </Button>
              <span className="text-caption text-ink-2">Minimize</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
