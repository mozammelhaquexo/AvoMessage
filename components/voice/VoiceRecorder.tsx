/**
 * components/voice/VoiceRecorder.tsx — hold/click-to-record voice message UI.
 *
 * Flow: idle → recording (live waveform + elapsed) → preview (listen, then
 * send or re-record). Cancel discards at any point. Mic-permission denial
 * renders a structured error state with retry instructions.
 *
 * The parent supplies `onSend(upload, durationMs)` — typically the message
 * composer, which creates the `messageType: VOICE` message with the returned
 * attachment. Upload goes through `POST /api/uploads` (kind `voice`).
 *
 * Interaction: press-and-hold the record button to record, release to stop;
 * a quick tap toggles recording on/off. Fully keyboard-operable
 * (Enter/Space toggles, Escape cancels).
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Button, Icon, Spinner } from '@/components/ui';
import { AudioPlayer } from './AudioPlayer';
import {
  VoiceRecorder as VoiceRecorderEngine,
  formatDuration,
  type MicError,
  type StopResult,
} from '@/lib/voice/recorder';
import { uploadVoice, type UploadedVoice } from '@/lib/voice/upload';

type Phase =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'preview'
  | 'uploading'
  | 'error'
  | 'unsupported';

export interface VoiceRecorderProps {
  /**
   * Called with the uploaded voice file + duration. The parent creates the
   * VOICE message (attachment `{ kind: 'VOICE', url, mimeType, sizeBytes }`).
   */
  onSend: (upload: UploadedVoice, durationMs: number) => void | Promise<void>;
  onCancel?: () => void;
  onError?: (err: MicError) => void;
  className?: string;
}

const WAVE_BARS = 48;

export function VoiceRecorderView({
  onSend,
  onCancel,
  onError,
  className,
}: VoiceRecorderProps) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>(
    VoiceRecorderEngine.isSupported() ? 'idle' : 'unsupported',
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const [micError, setMicError] = useState<MicError | null>(null);
  const [preview, setPreview] = useState<{
    url: string;
    durationMs: number;
    blob: Blob;
    autoStopped: boolean;
  } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const recorderRef = useRef<VoiceRecorderEngine | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const waveInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const waveRaf = useRef<number>(0);
  const pressRef = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const phaseRef = useRef(phase);

  // Mirrored from an effect so the stable callbacks below always see the
  // current phase without reading a ref written during render.
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const reportError = useCallback(
    (err: MicError) => {
      setMicError(err);
      setPhase('error');
      onError?.(err);
    },
    [onError],
  );

  const stopTimers = useCallback(() => {
    if (elapsedTimer.current) {
      clearInterval(elapsedTimer.current);
      elapsedTimer.current = null;
    }
    if (waveInterval.current) {
      clearInterval(waveInterval.current);
      waveInterval.current = null;
    }
    cancelAnimationFrame(waveRaf.current);
  }, []);

  const teardownRecorder = useCallback(() => {
    stopTimers();
    recorderRef.current?.cancel();
    recorderRef.current = null;
  }, [stopTimers]);

  // ── waveform ──────────────────────────────────────────────────────
  const drawWave = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = recorderRef.current?.getAnalyser();
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = canvas;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);

    ctx.clearRect(0, 0, width, height);
    const barW = width / WAVE_BARS;
    for (let i = 0; i < WAVE_BARS; i++) {
      // Sample the time-domain buffer across the bar.
      const idx = Math.floor((i / WAVE_BARS) * data.length);
      const v = Math.abs(data[idx] - 128) / 128; // 0..1
      const h = Math.max(3, v * height * 1.6);
      const x = i * barW + barW * 0.2;
      const y = (height - h) / 2;
      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, '#84cc16');
      grad.addColorStop(1, '#4d7c0f');
      ctx.fillStyle = grad;
      const w = barW * 0.6;
      const r = Math.min(w / 2, 3);
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();
    }
  }, []);

  const startWaveLoop = useCallback(() => {
    const analyser = recorderRef.current?.getAnalyser();
    if (!analyser) return;
    if (reduceMotion) {
      // Calmer updates when reduced motion is requested — still live.
      waveInterval.current = setInterval(drawWave, 250);
    } else {
      const loop = () => {
        drawWave();
        waveRaf.current = requestAnimationFrame(loop);
      };
      loop();
    }
  }, [drawWave, reduceMotion]);

  // ── recording lifecycle ───────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (phaseRef.current === 'recording' || phaseRef.current === 'starting') return;
    setSendError(null);
    setMicError(null);
    setPhase('starting');
    const rec = new VoiceRecorderEngine();
    recorderRef.current = rec;
    try {
      await rec.start();
    } catch (err) {
      recorderRef.current = null;
      reportError((err as MicError)?.code ? (err as MicError) : {
        code: 'unknown',
        title: 'Couldn’t start recording',
        hint: 'Check your microphone and try again.',
        retryable: true,
      });
      return;
    }
    setElapsedMs(0);
    setPhase('recording');
    startWaveLoop();
    elapsedTimer.current = setInterval(() => {
      const r = recorderRef.current;
      if (r) setElapsedMs(r.getElapsedMs());
    }, 250);
  }, [reportError, startWaveLoop]);

  const stopToPreview = useCallback(async () => {
    const rec = recorderRef.current;
    if (phaseRef.current !== 'recording' || !rec) return;
    stopTimers();
    let result: StopResult;
    try {
      result = await rec.stop();
    } catch (err) {
      recorderRef.current = null;
      const micErr = (err as { micError?: MicError })?.micError;
      reportError(
        micErr ?? {
          code: 'unknown',
          title: 'Recording failed',
          hint: 'Something went wrong while stopping the recording. Try again.',
          retryable: true,
        },
      );
      return;
    }
    recorderRef.current = null;
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview({
      url: URL.createObjectURL(result.blob),
      durationMs: result.durationMs,
      blob: result.blob,
      autoStopped: result.autoStopped,
    });
    setPhase('preview');
  }, [preview, reportError, stopTimers]);

  const handleCancel = useCallback(() => {
    teardownRecorder();
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setSendError(null);
    setPhase('idle');
    onCancel?.();
  }, [onCancel, preview, teardownRecorder]);

  const handleSend = useCallback(async () => {
    if (!preview || phaseRef.current === 'uploading') return;
    setSendError(null);
    setPhase('uploading');
    try {
      const upload = await uploadVoice(preview.blob, preview.durationMs);
      URL.revokeObjectURL(preview.url);
      const durationMs = preview.durationMs;
      setPreview(null);
      setPhase('idle');
      await onSend(upload, durationMs);
    } catch (err) {
      setPhase('preview');
      setSendError(
        err instanceof Error ? err.message : 'Upload failed. Try again.',
      );
    }
  }, [onSend, preview]);

  // Hold-to-record: pointerdown starts; release after ≥400ms stops.
  const onPressStart = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pressRef.current = Date.now();
      void startRecording();
    },
    [startRecording],
  );
  const onPressEnd = useCallback(() => {
    if (pressRef.current == null) return;
    const heldMs = Date.now() - pressRef.current;
    pressRef.current = null;
    if (heldMs >= 400 && phaseRef.current === 'recording') {
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 50);
      void stopToPreview();
    }
  }, [stopToPreview]);

  const onRecordClick = useCallback(() => {
    if (suppressClick.current) return;
    if (phaseRef.current === 'recording') void stopToPreview();
    else if (phaseRef.current === 'idle' || phaseRef.current === 'error') {
      setMicError(null);
      void startRecording();
    }
  }, [startRecording, stopToPreview]);

  const onRecordKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // The record button handles Space/Enter natively (click → toggle);
      // don't double-handle when the event comes from a button.
      const fromButton = !!(e.target as HTMLElement).closest('button');
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && !fromButton) {
        e.preventDefault();
        onRecordClick();
      }
      if (e.key === 'Escape') handleCancel();
    },
    [handleCancel, onRecordClick],
  );

  // Cleanup on unmount.
  useEffect(
    () => () => {
      teardownRecorder();
      if (preview?.url) URL.revokeObjectURL(preview.url);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── render ────────────────────────────────────────────────────────
  if (phase === 'unsupported') {
    return (
      <div
        role="alert"
        className={`flex items-center gap-3 rounded-md border border-line bg-surface px-4 py-3 ${className ?? ''}`}
      >
        <Icon name="micOff" className="h-5 w-5 shrink-0 text-ink-3" aria-hidden />
        <p className="text-body-sm text-ink-2">
          Voice messages aren’t supported in this browser. Try a recent version
          of Chrome, Edge, Firefox or Safari.
        </p>
      </div>
    );
  }

  if (phase === 'error' && micError) {
    return (
      <div
        role="alert"
        className={`rounded-md border border-danger/30 bg-danger/5 px-4 py-4 ${className ?? ''}`}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger/10">
            <Icon name="micOff" className="h-5 w-5 text-danger-strong" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-body-sm font-semibold text-ink">{micError.title}</p>
            <p className="mt-1 text-body-sm text-ink-2">{micError.hint}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {micError.retryable && (
                <Button size="sm" onClick={() => void startRecording()}>
                  <Icon name="refresh" className="h-4 w-4" aria-hidden />
                  Try again
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={handleCancel}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Voice recorder"
      className={`rounded-md border border-line bg-surface px-4 py-3 ${className ?? ''}`}
      onKeyDown={onRecordKeyDown}
    >
      {(phase === 'idle' || phase === 'starting') && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label={phase === 'starting' ? 'Starting recording' : 'Record voice message (press and hold, or tap to toggle)'}
            aria-pressed={false}
            disabled={phase === 'starting'}
            onPointerDown={onPressStart}
            onPointerUp={onPressEnd}
            onPointerCancel={onPressEnd}
            onPointerLeave={onPressEnd}
            onClick={onRecordClick}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-cta text-on-brand shadow-pop transition-transform duration-fast hover:brightness-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
          >
            {phase === 'starting' ? (
              <Spinner size="sm" aria-hidden />
            ) : (
              <Icon name="mic" className="h-5 w-5" aria-hidden />
            )}
          </button>
          <div className="min-w-0">
            <p className="text-body-sm font-medium text-ink">
              {phase === 'starting' ? 'Requesting microphone…' : 'Record a voice message'}
            </p>
            <p className="text-caption text-ink-3">
              Hold to record, release to stop — or tap to start and tap again to stop. Max 5 minutes.
            </p>
          </div>
        </div>
      )}

      {phase === 'recording' && (
        <div className="flex items-center gap-3">
          <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-danger text-white" aria-hidden>
            <span className={`absolute inset-0 rounded-full bg-danger ${reduceMotion ? '' : 'animate-ping opacity-30'}`} />
            <Icon name="mic" className="relative h-5 w-5" />
          </span>
          <canvas
            ref={canvasRef}
            width={360}
            height={44}
            aria-hidden
            className="h-11 min-w-0 flex-1"
          />
          <span
            role="timer"
            aria-live="off"
            aria-label={`Recording, ${formatDuration(elapsedMs)} elapsed`}
            className="w-12 shrink-0 text-right text-body-sm font-semibold tabular-nums text-ink"
          >
            {formatDuration(elapsedMs)}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Cancel recording"
            title="Cancel (Esc)"
            onClick={handleCancel}
          >
            <Icon name="x" className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-label="Stop recording and preview"
            onClick={() => void stopToPreview()}
          >
            <span className="h-2.5 w-2.5 rounded-[3px] bg-current" aria-hidden />
            Stop
          </Button>
        </div>
      )}

      {(phase === 'preview' || phase === 'uploading') && preview && (
        <div className="flex flex-col gap-3">
          {preview.autoStopped && (
            <p role="status" className="text-caption text-warning-strong">
              Recording stopped automatically at the 5-minute limit.
            </p>
          )}
          <AudioPlayer src={preview.url} durationMs={preview.durationMs} />
          {sendError && (
            <p role="alert" className="text-body-sm text-danger-strong">
              {sendError}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => void handleSend()}
              loading={phase === 'uploading'}
              disabled={phase === 'uploading'}
            >
              <Icon name="send" className="h-4 w-4" aria-hidden />
              Send voice message
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={phase === 'uploading'}
              onClick={() => {
                if (preview.url) URL.revokeObjectURL(preview.url);
                setPreview(null);
                setSendError(null);
                setPhase('idle');
              }}
            >
              <Icon name="refresh" className="h-4 w-4" aria-hidden />
              Re-record
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={phase === 'uploading'}
              onClick={handleCancel}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Alias matching the file name for ergonomic imports. */
export const VoiceRecorder = VoiceRecorderView;
