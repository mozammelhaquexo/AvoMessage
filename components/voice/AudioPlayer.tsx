/**
 * components/voice/AudioPlayer.tsx — playback for voice messages.
 *
 * Play/pause, click/drag + keyboard seek bar, elapsed/total duration, a
 * precomputed mini-waveform, playback-speed control and an optional download
 * button. Used inside MessageBubble for VOICE messages and by VoiceRecorder's
 * preview step.
 *
 * ── THE FIVE THINGS THAT MADE THIS LOOK "GLITCHED" ──────────────────────
 *
 * 1. THE WAVEFORM COULD NOT FIT. It drew a fixed 56 bars of `w-[3px]
 *    shrink-0` — 278px of rigid pixels — inside a bubble capped at 208px.
 *    `shrink-0` forbids the flexbox from reclaiming any of it, so the bars
 *    overflowed and pushed the duration and speed controls out of the row.
 *    Now the bar count is derived from the measured track width (see
 *    `lib/voice/waveform.ts`), so the waveform always fits whatever space the
 *    bubble has — including when the window is resized or the sidebar opens.
 *
 * 2. A FRESH `AudioContext` PER MESSAGE. `getPeaks` constructed one per decode
 *    and closed it after. Chrome caps hardware contexts per page (around six)
 *    and `decodeAudioData` is async, so opening a chat with a dozen voice notes
 *    fired a dozen contexts at once; past the cap the constructor throws, the
 *    decode silently fell back to a flat line, and waveforms appeared to
 *    "load wrong" for no visible reason. Now one context serves the whole page
 *    and is never closed, and decodes are queued two at a time.
 *
 * 3. EVERY `timeupdate` REBUILT ALL 56 BARS. Progress was baked into each bar's
 *    className, so the browser's ~4Hz time update re-created 56 elements and
 *    re-diffed them while the clip played. Progress is now painted by clipping
 *    a second copy of the bars with `clip-path`, which is one style write per
 *    tick instead of 56 element rebuilds.
 *
 * 4. TWO VOICE NOTES COULD PLAY AT ONCE. Each player owned its own element with
 *    nothing coordinating them, so starting a second note layered the audio.
 *    A module-level registry pauses the previous note.
 *
 * 5. THE SPEED BUTTON LIED. `playbackRate` was only set on click; a new `src`
 *    reset the element to 1x while the button still read "1.5x". It is now
 *    re-applied whenever `src` or `speed` changes.
 *
 * Accessibility: the waveform doubles as a `role="slider"` (arrows/Home/End
 * seek); the play button carries full labels; no autoplay.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon, cn } from '@/components/ui';
import { downloadFileName, downloadUrl } from '@/lib/download';
import { formatDuration } from '@/lib/voice/recorder';
import {
  PEAK_SAMPLES,
  barCountForWidth,
  flatPeaks,
  peaksFromChannelData,
  placeholderPeaks,
  resamplePeaks,
} from '@/lib/voice/waveform';

export interface AudioPlayerProps {
  src: string;
  /** Known duration (e.g. from the recorder); falls back to metadata. */
  durationMs?: number;
  /** Accessible label, e.g. "Voice message from Ada, 0:42". */
  label?: string;
  compact?: boolean;
  className?: string;
  /** Used to pick the extension for a download. */
  mimeType?: string | null;
  /**
   * The name to save the clip under. Passing this prop at all — even as `null`
   * — renders the download control; omitting it hides it, which is what the
   * recorder's preview step wants.
   */
  downloadName?: string | null;
}

/* ── One decode context for the whole page ─────────────────────────────
 * See note 2 above. Created lazily, reused forever, never closed: closing it
 * would force the next decode to construct another one and walk straight back
 * into the per-page cap. `sharedContextRefused` remembers a constructor
 * failure so a browser that will not give us one is not asked on every clip.
 */
let sharedContext: AudioContext | null = null;
let sharedContextRefused = false;

function decodeContext(): AudioContext | null {
  if (sharedContext) return sharedContext;
  if (sharedContextRefused) return null;

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    sharedContextRefused = true;
    return null;
  }
  try {
    sharedContext = new Ctor();
    return sharedContext;
  } catch {
    // Chrome throws once its hardware-context budget is spent. One shared
    // context means we should never get here, but if we do, fall back to a
    // placeholder waveform rather than retrying on every message.
    sharedContextRefused = true;
    return null;
  }
}

/* ── Bounded decode queue ──────────────────────────────────────────────
 * A chat can hold dozens of voice notes; decoding all of them at once spikes
 * CPU and memory. Two at a time keeps the visible ones fast without a stampede.
 */
const MAX_CONCURRENT_DECODES = 2;
let activeDecodes = 0;
const decodeWaiters: Array<() => void> = [];

function acquireDecodeSlot(): Promise<void> {
  if (activeDecodes < MAX_CONCURRENT_DECODES) {
    activeDecodes += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    decodeWaiters.push(() => {
      activeDecodes += 1;
      resolve();
    });
  });
}

function releaseDecodeSlot(): void {
  activeDecodes = Math.max(0, activeDecodes - 1);
  decodeWaiters.shift()?.();
}

/* ── Peaks cache ───────────────────────────────────────────────────────
 * Keyed by src and capped, so scrolling a long history does not retain every
 * decoded clip for the lifetime of the tab.
 */
const PEAKS_CACHE_LIMIT = 80;
const peaksCache = new Map<string, number[]>();
const decodeQueue = new Map<string, Promise<number[]>>();

function rememberPeaks(src: string, peaks: number[]): void {
  peaksCache.set(src, peaks);
  while (peaksCache.size > PEAKS_CACHE_LIMIT) {
    const oldest = peaksCache.keys().next().value;
    if (oldest === undefined || oldest === src) break;
    peaksCache.delete(oldest);
  }
}

/**
 * Decode a clip's waveform, once per src.
 *
 * Deduplicated through `decodeQueue` so ten re-renders of the same bubble do
 * not start ten fetches. Never rejects — a clip we cannot read gets a flat
 * waveform and the player still works, because the waveform is decoration and
 * the audio element is the actual product.
 */
async function getPeaks(src: string): Promise<number[]> {
  const cached = peaksCache.get(src);
  if (cached) return cached;
  const queued = decodeQueue.get(src);
  if (queued) return queued;

  const job = (async (): Promise<number[]> => {
    await acquireDecodeSlot();
    try {
      const res = await fetch(src);
      if (!res.ok) return flatPeaks(PEAK_SAMPLES);
      const buffer = await res.arrayBuffer();
      const ctx = decodeContext();
      if (!ctx) return flatPeaks(PEAK_SAMPLES);

      const decoded = await ctx.decodeAudioData(buffer);
      const peaks = peaksFromChannelData(decoded.getChannelData(0), PEAK_SAMPLES);
      rememberPeaks(src, peaks);
      return peaks;
    } catch {
      return flatPeaks(PEAK_SAMPLES);
    } finally {
      releaseDecodeSlot();
      decodeQueue.delete(src);
    }
  })();

  decodeQueue.set(src, job);
  return job;
}

/* ── One voice note at a time ──────────────────────────────────────────
 * See note 4 above.
 */
let playingAudio: HTMLAudioElement | null = null;

function claimPlayback(audio: HTMLAudioElement): void {
  if (playingAudio && playingAudio !== audio) playingAudio.pause();
  playingAudio = audio;
}

function releasePlayback(audio: HTMLAudioElement): void {
  if (playingAudio === audio) playingAudio = null;
}

const SPEEDS = [1, 1.25, 1.5, 2] as const;

/** Bars drawn in the "unavailable" fallback — small enough to never overflow. */
const FALLBACK_BARS = 24;

export function AudioPlayer({
  src,
  durationMs,
  label,
  compact = false,
  className,
  mimeType,
  downloadName,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  /**
   * Duration read from the element's metadata. Deliberately separate from the
   * `durationMs` prop: the recorder knows the true length and the container's
   * guess is only a fallback, so `totalMs` below derives from both and the
   * prop wins without an effect copying it into state.
   */
  const [metadataMs, setMetadataMs] = useState(0);
  /** `null` until decoded — distinct from "decoded to nothing". */
  const [peaks, setPeaks] = useState<number[] | null>(() => peaksCache.get(src) ?? null);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [failed, setFailed] = useState(false);
  const [barCount, setBarCount] = useState(0);
  const dragging = useRef(false);

  const totalMs = durationMs ?? metadataMs;

  useEffect(() => {
    let alive = true;
    // A new `src` is a different clip: its progress, its play state and its
    // waveform all belong to the old one. The effect is the right place
    // because the decode below is an async subscription to a URL.
    /* eslint-disable react-hooks/set-state-in-effect -- reset per-source view state, then subscribe to the new source */
    setFailed(false);
    setPlaying(false);
    setCurrentMs(0);
    setPeaks(peaksCache.get(src) ?? null);
    /* eslint-enable react-hooks/set-state-in-effect */

    getPeaks(src).then((p) => {
      if (alive) setPeaks(p);
    });
    return () => {
      alive = false;
    };
  }, [src]);

  /* ── Bar count follows the available width ───────────────────────────── */

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const apply = (width: number) => {
      setBarCount((previous) => {
        const next = barCountForWidth(width);
        return next === previous ? previous : next;
      });
    };

    // Measure immediately so the first paint is already correct, then keep up
    // with the container: a bubble narrows when the sidebar opens, when the
    // window shrinks, and when a neighbouring message claims more of the row.
    apply(track.clientWidth);

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      apply(entries[0]?.contentRect.width ?? track.clientWidth);
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  /* ── The speed button must not lie about the element's rate ──────────── */

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed, src]);

  /* ── Stop this clip when the bubble goes away ────────────────────────── */

  useEffect(() => {
    // Captured at effect time rather than read from the ref inside the
    // cleanup: React detaches refs before cleanups run, so `audioRef.current`
    // would already be null and the clip would keep playing after its bubble
    // unmounted.
    const audio = audioRef.current;
    return () => {
      if (!audio) return;
      releasePlayback(audio);
      audio.pause();
    };
  }, []);

  const seekTo = useCallback((ms: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    const clamped = Math.max(0, Math.min(ms, audio.duration * 1000));
    audio.currentTime = clamped / 1000;
    setCurrentMs(clamped);
  }, []);

  const seekFromPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      const audio = audioRef.current;
      if (!track || !audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
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
      claimPlayback(audio);
      void audio.play().catch(() => {
        releasePlayback(audio);
        setFailed(true);
      });
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

  /* ── Bars ────────────────────────────────────────────────────────────── */

  // Resampled to the measured bar count. Before the clip decodes we show a
  // stable placeholder derived from the src, so the row keeps its shape and
  // the real waveform swaps in without the layout jumping.
  const heights = useMemo(() => {
    if (barCount <= 0) return [];
    if (!peaks || peaks.length === 0) return placeholderPeaks(src, barCount);
    return resamplePeaks(peaks, barCount);
  }, [peaks, src, barCount]);

  // Two copies of the same geometry: one grey, one brand-coloured and clipped
  // to the played fraction. Built from `heights` only, so a time update writes
  // a single style property instead of rebuilding every bar.
  const baseBars = useMemo(
    () =>
      heights.map((h, i) => (
        <span
          key={i}
          aria-hidden
          className="w-[2px] shrink-0 rounded-full bg-line-strong/70"
          style={{ height: `${Math.round(h * 100)}%`, minHeight: 3 }}
        />
      )),
    [heights],
  );

  const playedBars = useMemo(
    () =>
      heights.map((h, i) => (
        <span
          key={i}
          aria-hidden
          className="w-[2px] shrink-0 rounded-full bg-brand-strong"
          style={{ height: `${Math.round(h * 100)}%`, minHeight: 3 }}
        />
      )),
    [heights],
  );

  const fileName = useMemo(
    () => downloadFileName({ name: downloadName, url: src, mimeType, prefix: 'voice-message' }),
    [downloadName, src, mimeType],
  );

  const sliderLabel = label ?? `Voice message, ${formatDuration(totalMs)}`;
  const showDownload = downloadName !== undefined;

  if (failed) {
    // Graceful degradation: keep the player chrome so the bubble layout
    // stays stable; the note is simply unavailable.
    return (
      <div role="alert" className={cn('flex w-full items-center gap-2.5 opacity-75', className)}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-3">
          <Icon name="mic" size={16} aria-hidden />
        </span>
        <div className="flex h-9 min-w-0 flex-1 items-center justify-between overflow-hidden" aria-hidden>
          {Array.from({ length: FALLBACK_BARS }).map((_, i) => (
            <span
              key={i}
              className="w-[2px] shrink-0 rounded-full bg-line-strong/50"
              style={{ height: `${22 + ((i * 41 + 13) % 58)}%`, minHeight: 3 }}
            />
          ))}
        </div>
        <span className="shrink-0 text-caption text-ink-3">Unavailable</span>
      </div>
    );
  }

  return (
    <div className={cn('flex w-full items-center', compact ? 'gap-2' : 'gap-2.5', className)}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        playsInline
        onTimeUpdate={(e) => {
          if (!dragging.current) setCurrentMs(e.currentTarget.currentTime * 1000);
        }}
        onLoadedMetadata={(e) => {
          const audio = e.currentTarget;
          // Re-apply the chosen rate: assigning `src` resets it to 1 while the
          // speed button still shows the user's pick.
          audio.playbackRate = speed;
          const d = audio.duration;
          if (Number.isFinite(d) && d > 0) setMetadataMs(d * 1000);
        }}
        onPlay={() => setPlaying(true)}
        onPause={(e) => {
          setPlaying(false);
          releasePlayback(e.currentTarget);
        }}
        onEnded={(e) => {
          setPlaying(false);
          setCurrentMs(totalMs);
          releasePlayback(e.currentTarget);
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

      {/*
        The slider IS the waveform track, and it owns both bar rows. Measuring
        and seeking use this element, and the overlay is `inset-0` of it, so the
        grey and coloured rows line up exactly — that is why there is no
        padding here (padding would offset the absolute overlay by its own
        width and the played bars would drift from the grey ones).
      */}
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={sliderLabel}
        aria-valuemin={0}
        aria-valuemax={Math.round(totalMs / 1000)}
        aria-valuenow={Math.round(currentMs / 1000)}
        aria-valuetext={`${formatDuration(currentMs)} of ${formatDuration(totalMs)}`}
        onKeyDown={onSliderKeyDown}
        onPointerDown={(e) => {
          // Capture on the slider itself, not on `e.target`: the bars are
          // pointer-events-none, so every event lands here anyway, and
          // capturing on a child that React may replace would drop the drag.
          e.currentTarget.setPointerCapture?.(e.pointerId);
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
        className="relative h-9 min-w-0 flex-1 cursor-pointer touch-none overflow-hidden rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <div className="pointer-events-none flex h-full w-full items-center justify-between gap-[2px]" aria-hidden>
          {baseBars}
        </div>
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-between gap-[2px]"
          aria-hidden
          style={{ clipPath: `inset(0 ${100 - progress * 100}% 0 0)` }}
        >
          {playedBars}
        </div>
      </div>

      <span
        className={cn('shrink-0 tabular-nums text-ink-2', compact ? 'text-tiny' : 'text-caption')}
        aria-hidden
      >
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
        className={cn(
          'shrink-0 rounded-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand',
          compact ? 'px-1 py-0.5 text-tiny' : 'px-1.5 py-1 text-caption',
        )}
      >
        {speed}x
      </button>

      {showDownload && (
        <a
          href={downloadUrl(src, fileName)}
          // Same-origin proxy: the `download` attribute is ignored for a
          // cross-origin URL, which is what the S3 driver returns in prod.
          download={fileName}
          aria-label={`Download ${label ?? 'voice message'}`}
          title="Download voice message"
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand',
            compact ? 'h-7 w-7' : 'h-8 w-8',
          )}
        >
          <Icon name="download" size={14} aria-hidden />
        </a>
      )}
    </div>
  );
}
