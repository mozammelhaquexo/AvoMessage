/**
 * components/voice/AudioPlayer.tsx — playback for voice messages.
 *
 * Play/pause, click/drag + keyboard seek bar, elapsed/total duration, a
 * precomputed mini-waveform (peaks decoded once per `src` and cached), and
 * playback-speed control. Used inside MessageBubble for VOICE messages and
 * by VoiceRecorder's preview step.
 *
 * Accessibility: the waveform doubles as a `role="slider"` (arrows/Home/End
 * seek); the play button carries full labels; no autoplay.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon } from '@/components/ui';
import { formatDuration } from '@/lib/voice/recorder';

export interface AudioPlayerProps {
  src: string;
  /** Known duration (e.g. from the recorder); falls back to metadata. */
  durationMs?: number;
  /** Accessible label, e.g. "Voice message from Ada, 0:42". */
  label?: string;
  compact?: boolean;
  className?: string;
}

const PEAK_COUNT = 56;
/** src → peaks cache so re-renders / list virtualization don't re-decode. */
const peaksCache = new Map<string, number[]>();
const decodeQueue = new Map<string, Promise<number[]>>();

async function getPeaks(src: string): Promise<number[]> {
  const cached = peaksCache.get(src);
  if (cached) return cached;
  const queued = decodeQueue.get(src);
  if (queued) return queued;
  const job = (async () => {
    try {
      const res = await fetch(src);
      const buf = await res.arrayBuffer();
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return new Array(PEAK_COUNT).fill(0.3);
      const audioCtx = new Ctx();
      try {
        const audioBuf = await audioCtx.decodeAudioData(buf);
        const channel = audioBuf.getChannelData(0);
        const block = Math.max(1, Math.floor(channel.length / PEAK_COUNT));
        const peaks: number[] = [];
        for (let i = 0; i < PEAK_COUNT; i++) {
          let max = 0;
          const start = i * block;
          // Sample every 16th frame — cheap and plenty for a thumbnail.
          for (let j = start; j < Math.min(start + block, channel.length); j += 16) {
            const v = Math.abs(channel[j]);
            if (v > max) max = v;
          }
          peaks.push(Math.max(0.06, Math.min(1, max)));
        }
        peaksCache.set(src, peaks);
        return peaks;
      } finally {
        void audioCtx.close().catch(() => undefined);
      }
    } catch {
      return new Array(PEAK_COUNT).fill(0.25);
    } finally {
      decodeQueue.delete(src);
    }
  })();
  decodeQueue.set(src, job);
  return job;
}

const SPEEDS = [1, 1.25, 1.5, 2] as const;

export function AudioPlayer({
  src,
  durationMs,
  label,
  compact = false,
  className,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [totalMs, setTotalMs] = useState(durationMs ?? 0);
  const [peaks, setPeaks] = useState<number[]>(() => peaksCache.get(src) ?? []);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [failed, setFailed] = useState(false);
  const dragging = useRef(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    setPlaying(false);
    setCurrentMs(0);
    getPeaks(src).then((p) => {
      if (alive) setPeaks(p);
    });
    return () => {
      alive = false;
    };
  }, [src]);

  useEffect(() => {
    if (durationMs != null) setTotalMs(durationMs);
  }, [durationMs]);

  const seekTo = useCallback(
    (ms: number) => {
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(audio.duration)) return;
      const clamped = Math.max(0, Math.min(ms, audio.duration * 1000));
      audio.currentTime = clamped / 1000;
      setCurrentMs(clamped);
    },
    [],
  );

  const seekFromPointer = useCallback(
    (clientX: number) => {
      const bar = barRef.current;
      const audio = audioRef.current;
      if (!bar || !audio || !Number.isFinite(audio.duration) || audio.duration <= 0)
        return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      seekTo(ratio * audio.duration * 1000);
    },
    [seekTo],
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || failed) return;
    if (audio.paused) {
      // Restart from the beginning when replaying a finished clip.
      if (Number.isFinite(audio.duration) && audio.currentTime >= audio.duration - 0.05) {
        audio.currentTime = 0;
      }
      void audio.play().catch(() => setFailed(true));
    } else {
      audio.pause();
    }
  }, [failed]);

  const onSliderKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = 5000;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekTo(currentMs - step);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekTo(currentMs + step);
      } else if (e.key === 'Home') {
        e.preventDefault();
        seekTo(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        seekTo(totalMs);
      }
    },
    [currentMs, seekTo, totalMs],
  );

  const progress = totalMs > 0 ? Math.min(1, currentMs / totalMs) : 0;
  const sliderLabel =
    label ?? `Voice message, ${formatDuration(totalMs)}`;

  const bars = useMemo(
    () =>
      peaks.map((p, i) => {
        const played = i / Math.max(1, peaks.length - 1) <= progress;
        return (
          <span
            key={i}
            aria-hidden
            className={`w-[3px] shrink-0 rounded-full ${played ? 'bg-brand-strong' : 'bg-line-strong/70'}`}
            style={{ height: `${Math.round(p * 100)}%` }}
          />
        );
      }),
    [peaks, progress],
  );

  if (failed) {
    // Graceful degradation: keep the player chrome so the bubble layout
    // stays stable; the note is simply unavailable.
    return (
      <div
        role="alert"
        className={`flex items-center gap-2.5 opacity-75 ${className ?? ''}`}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-3">
          <Icon name="mic" size={16} aria-hidden />
        </span>
        <div className="flex h-9 min-w-0 flex-1 items-center gap-[2px]" aria-hidden>
          {Array.from({ length: 28 }).map((_, i) => (
            <span
              key={i}
              className="w-[3px] shrink-0 rounded-full bg-line-strong/50"
              style={{ height: `${22 + ((i * 41 + 13) % 58)}%` }}
            />
          ))}
        </div>
        <span className="shrink-0 text-caption text-ink-3">Unavailable</span>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-2.5 ${compact ? '' : 'min-w-0'} ${className ?? ''}`}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        playsInline
        onTimeUpdate={(e) => {
          if (!dragging.current) setCurrentMs(e.currentTarget.currentTime * 1000);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0 && !durationMs) setTotalMs(d * 1000);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentMs(totalMs);
        }}
        onError={() => setFailed(true)}
      />
      <Button
        size="icon-sm"
        variant="secondary"
        aria-label={playing ? `Pause ${sliderLabel}` : `Play ${sliderLabel}`}
        aria-pressed={playing}
        onClick={togglePlay}
        className="shrink-0"
      >
        {playing ? (
          <span aria-hidden className="flex items-center gap-[3px]">
            <span className="h-3.5 w-[3px] rounded-full bg-current" />
            <span className="h-3.5 w-[3px] rounded-full bg-current" />
          </span>
        ) : (
          <span
            aria-hidden
            className="ml-0.5 block h-0 w-0 border-y-[7px] border-l-[11px] border-y-transparent border-l-current"
          />
        )}
      </Button>

      <div
        ref={barRef}
        role="slider"
        tabIndex={0}
        aria-label={sliderLabel}
        aria-valuemin={0}
        aria-valuemax={Math.round(totalMs / 1000)}
        aria-valuenow={Math.round(currentMs / 1000)}
        aria-valuetext={`${formatDuration(currentMs)} of ${formatDuration(totalMs)}`}
        onKeyDown={onSliderKeyDown}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          dragging.current = true;
          seekFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) seekFromPointer(e.clientX);
        }}
        onPointerUp={(e) => {
          if (dragging.current) {
            dragging.current = false;
            seekFromPointer(e.clientX);
          }
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        className="flex h-9 min-w-0 flex-1 cursor-pointer touch-none items-center gap-[2px] rounded-sm px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {bars}
      </div>

      <span className="shrink-0 text-caption tabular-nums text-ink-2" aria-hidden>
        {formatDuration(currentMs)} / {formatDuration(totalMs)}
      </span>

      <button
        type="button"
        aria-label={`Playback speed, currently ${speed}x`}
        title="Playback speed"
        onClick={() => {
          const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
          setSpeed(next);
          if (audioRef.current) audioRef.current.playbackRate = next;
        }}
        className="shrink-0 rounded-sm px-1.5 py-1 text-caption font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
      >
        {speed}x
      </button>
    </div>
  );
}
