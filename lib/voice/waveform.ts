/**
 * lib/voice/waveform.ts — the maths behind a voice-note waveform.
 *
 * WHY THIS IS A SEPARATE, PURE MODULE
 * The player used to draw a FIXED 56 bars of `w-[3px] shrink-0`. That is 56×3
 * + 55×2 = 278px of rigid pixels, and `shrink-0` means the flexbox cannot
 * reclaim any of it. Inside a chat bubble capped at `max-w-52` (208px) the
 * waveform had nowhere to go: it either overflowed the bubble or was clipped,
 * and the duration and speed controls were shoved out of the row. That is the
 * "glitch" the waveform was reported for.
 *
 * The fix is to decide the bar count from the width actually available, which
 * means the layout maths has to be honest and testable. Keeping it here — free
 * of DOM, React and `AudioContext` — means the awkward cases (zero width, a
 * narrower-than-minimum track, peaks shorter than the bar count, an empty
 * decode) can be pinned by unit tests instead of eyeballed in a browser.
 */

/** Peaks kept per clip. More than any bar count we render, so resampling down never invents detail. */
export const PEAK_SAMPLES = 64;

/** Fewest bars worth drawing — below this a waveform is just noise. */
export const MIN_BARS = 12;

/** Most bars worth drawing — beyond this they stop being distinguishable. */
export const MAX_BARS = 56;

/** Bar stroke width, in px. */
export const BAR_WIDTH = 2;

/** Minimum gap between bars, in px. */
export const BAR_GAP = 2;

/** Shortest bar, as a fraction of the track height — a silent stretch still reads as a bar. */
export const MIN_PEAK = 0.08;

/** What an undecodable clip falls back to. Deliberately low so it reads as "no data", not "quiet". */
const FALLBACK_PEAK = 0.25;

/** A flat waveform, for a clip we could not decode. */
export function flatPeaks(count: number): number[] {
  return new Array(Math.max(0, Math.floor(count))).fill(FALLBACK_PEAK);
}

/**
 * How many bars fit in `width` px without overflowing.
 *
 * Solves `n * BAR_WIDTH + (n - 1) * BAR_GAP <= width` for the largest integer
 * `n`, then clamps into `[MIN_BARS, MAX_BARS]`. The clamp is what makes a
 * very narrow track overflow *on purpose* rather than collapse to one bar:
 * the container clips it, which looks like a cropped waveform instead of a
 * broken layout.
 */
export function barCountForWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return MIN_BARS;
  const fitted = Math.floor((width + BAR_GAP) / (BAR_WIDTH + BAR_GAP));
  return Math.max(MIN_BARS, Math.min(MAX_BARS, fitted));
}

/**
 * Reduce a decoded channel to `count` peak amplitudes in `[MIN_PEAK, 1]`.
 *
 * Takes the MAXIMUM over each bucket rather than the average: an average
 * flattens a short loud syllable into the silence around it, so a word spoken
 * between pauses disappears. Max keeps transients visible, which is the whole
 * point of a waveform.
 */
export function peaksFromChannelData(channel: Float32Array, count = PEAK_SAMPLES): number[] {
  if (count <= 0) return [];
  if (channel.length === 0) return flatPeaks(count);

  const block = channel.length / count;
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * block);
    // Always advance by at least one sample, so `block < 1` (a clip shorter
    // than the sample count) still produces distinct bars.
    const end = Math.max(start + 1, Math.min(channel.length, Math.floor((i + 1) * block)));

    let max = 0;
    // Sampling every 8th frame is plenty for a thumbnail and keeps a long
    // clip cheap to scan; it cannot miss a transient that lasts >8 frames.
    const stride = Math.max(1, Math.floor((end - start) / 256));
    for (let j = start; j < end; j += stride) {
      const value = Math.abs(channel[j]!);
      if (value > max) max = value;
    }
    peaks.push(Math.max(MIN_PEAK, Math.min(1, max)));
  }
  return peaks;
}

/**
 * Stretch or squash `peaks` to exactly `count` entries.
 *
 * Needed because the bar count follows the available width while the decoded
 * peaks are a fixed-length array: a bubble resized from 300px to 120px has to
 * show the same clip in 30 bars instead of 70. Also takes the maximum per
 * bucket, so shrinking never hides a loud moment.
 */
export function resamplePeaks(peaks: number[], count: number): number[] {
  if (count <= 0) return [];
  if (peaks.length === 0) return flatPeaks(count);
  if (peaks.length === count) return peaks;

  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * peaks.length) / count);
    const end = Math.max(start + 1, Math.floor(((i + 1) * peaks.length) / count));

    let max = 0;
    for (let j = start; j < end && j < peaks.length; j++) {
      const value = peaks[j]!;
      if (value > max) max = value;
    }
    out.push(Math.max(MIN_PEAK, Math.min(1, max)));
  }
  return out;
}

/**
 * A stable, source-derived bar pattern used while a clip is still decoding.
 *
 * Deterministic on purpose: a random pattern would reshuffle on every render
 * and read as a flicker. Deriving it from the string means the placeholder is
 * at least stable, and the real peaks replace it in place.
 */
export function placeholderPeaks(seed: string, count: number): number[] {
  if (count <= 0) return [];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    hash = (hash * 1103515245 + 12345) | 0;
    // Map into 0.3–0.85 so a placeholder reads as "a waveform", never as a
    // confident loud or silent passage.
    const t = (Math.abs(hash) % 1000) / 1000;
    out.push(0.3 + t * 0.55);
  }
  return out;
}
