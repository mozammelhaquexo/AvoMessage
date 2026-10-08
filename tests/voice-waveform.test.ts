/**
 * tests/voice-waveform.test.ts — the geometry that made the voice bubble look
 * "glitched", and the peak maths behind the drawn waveform.
 *
 * THE BUG THIS FILE EXISTS TO PIN
 * The player drew a fixed 56 bars of `w-[3px]` with `gap-[2px]`, every one of
 * them `shrink-0`. That is 278px of pixels the flexbox is forbidden to reclaim,
 * inside a bubble capped at `max-w-52` (208px). The waveform had nowhere to go,
 * so it overflowed and pushed the duration and speed controls out of the row —
 * which is what "kemon jeno glitch hoye ache" was describing.
 *
 * The fix moves the bar count onto the measured width, so the property that
 * matters is: **the bars never ask for more room than they were given**. That
 * is asserted exhaustively below, over every width from 1px to 900px, rather
 * than at a handful of hand-picked sizes — a formula that is only right at the
 * sizes you thought to test is exactly how this broke the first time.
 *
 * Everything here is pure: no DOM, no `AudioContext`, no React.
 */
import { describe, expect, it } from 'vitest';
import {
  BAR_GAP,
  BAR_WIDTH,
  MAX_BARS,
  MIN_BARS,
  MIN_PEAK,
  PEAK_SAMPLES,
  barCountForWidth,
  flatPeaks,
  peaksFromChannelData,
  placeholderPeaks,
  resamplePeaks,
} from '@/lib/voice/waveform';

/** The width `count` bars actually occupy, gaps included. */
function neededWidth(count: number): number {
  return count * BAR_WIDTH + Math.max(0, count - 1) * BAR_GAP;
}

describe('the original bug', () => {
  it('was a fixed waveform wider than the bubble it lived in', () => {
    // The numbers the old component hard-coded.
    const oldBarCount = 56;
    const oldBarWidth = 3;
    const oldGap = 2;
    const oldNeeded = oldBarCount * oldBarWidth + (oldBarCount - 1) * oldGap;

    expect(oldNeeded).toBe(278);

    // `max-w-52` on the voice wrapper is 13rem.
    const bubbleContentWidth = 208;
    expect(oldNeeded).toBeGreaterThan(bubbleContentWidth);
  });

  it('is fixed: the new bars always fit the width they were measured for', () => {
    for (let width = 1; width <= 900; width += 1) {
      const count = barCountForWidth(width);
      // Below the minimum the count is clamped UP on purpose, and the
      // container clips the overflow — that is the documented trade-off, and
      // it is covered by its own test below.
      if (count === MIN_BARS && neededWidth(count) > width) continue;
      expect(neededWidth(count), `width=${width} count=${count}`).toBeLessThanOrEqual(width);
    }
  });

  it('is fixed at the narrowest track the player actually sees', () => {
    // A 375px phone: the bubble is capped at 75% of the row, and the fixed
    // controls in the row (play button, timer, speed chip, download) leave
    // roughly this much for the waveform.
    const phoneTrack = 65;
    const count = barCountForWidth(phoneTrack);

    expect(count).toBeGreaterThanOrEqual(MIN_BARS);
    expect(count).toBeLessThanOrEqual(MAX_BARS);
    expect(neededWidth(count)).toBeLessThanOrEqual(phoneTrack);
  });

  it('only overflows below the minimum, and only because it clamps up', () => {
    const smallestFit = neededWidth(MIN_BARS);

    expect(barCountForWidth(smallestFit)).toBe(MIN_BARS);
    // One pixel narrower than the minimum can fit: still MIN_BARS, so it
    // overflows rather than collapsing to a single meaningless bar.
    expect(barCountForWidth(smallestFit - 1)).toBe(MIN_BARS);
    expect(neededWidth(MIN_BARS)).toBeGreaterThan(smallestFit - 1);
  });
});

describe('barCountForWidth', () => {
  it('caps at MAX_BARS on a track wide enough for more', () => {
    expect(barCountForWidth(5000)).toBe(MAX_BARS);
    expect(barCountForWidth(neededWidth(MAX_BARS))).toBe(MAX_BARS);
  });

  it('grows one bar at a time as the track widens', () => {
    const narrow = barCountForWidth(100);
    const wide = barCountForWidth(300);
    expect(wide).toBeGreaterThan(narrow);
  });

  it('falls back to MIN_BARS for a width it cannot trust', () => {
    // `clientWidth` is 0 before layout, and a detached node reports 0 too.
    expect(barCountForWidth(0)).toBe(MIN_BARS);
    expect(barCountForWidth(-100)).toBe(MIN_BARS);
    expect(barCountForWidth(Number.NaN)).toBe(MIN_BARS);
  });
});

describe('resamplePeaks', () => {
  it('always returns exactly the requested number of bars', () => {
    for (const count of [1, 2, 7, 30, 56, 100]) {
      expect(resamplePeaks([0.2, 0.5, 0.9], count)).toHaveLength(count);
    }
  });

  it('keeps the loudest sample when shrinking, so a transient survives', () => {
    // One loud bar among quiet ones. Averaging would smear it into its
    // neighbours and the syllable would vanish from the waveform.
    const peaks = [0.1, 0.1, 0.1, 0.1, 1, 0.1, 0.1, 0.1];
    const shrunk = resamplePeaks(peaks, 2);

    expect(shrunk).toHaveLength(2);
    expect(Math.max(...shrunk)).toBe(1);
  });

  it('returns the same array when the count already matches', () => {
    const peaks = [0.3, 0.6, 0.9];
    expect(resamplePeaks(peaks, 3)).toBe(peaks);
  });

  it('substitutes a flat waveform for an empty decode', () => {
    expect(resamplePeaks([], 5)).toEqual(flatPeaks(5));
  });

  it('returns nothing for a non-positive count', () => {
    expect(resamplePeaks([0.5], 0)).toEqual([]);
    expect(resamplePeaks([0.5], -3)).toEqual([]);
  });

  it('never emits a bar below the floor or above full height', () => {
    const spiky = [0, 0, 5, -1, 0.5, Number.NaN];
    for (const value of resamplePeaks(spiky, 9)) {
      expect(value).toBeGreaterThanOrEqual(MIN_PEAK);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('peaksFromChannelData', () => {
  it('finds a loud transient and floors the silence around it', () => {
    // 8 samples into 4 buckets: [0,0] [0,1] [0,0] [0,0]
    const channel = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0]);
    expect(peaksFromChannelData(channel, 4)).toEqual([MIN_PEAK, 1, MIN_PEAK, MIN_PEAK]);
  });

  it('floors a completely silent clip instead of drawing zero-height bars', () => {
    const peaks = peaksFromChannelData(new Float32Array(512), 8);
    expect(peaks).toHaveLength(8);
    for (const value of peaks) expect(value).toBe(MIN_PEAK);
  });

  it('uses the absolute value, so a negative trough counts as loud', () => {
    const channel = new Float32Array([0, 0, -1, -1, 0, 0, 0, 0]);
    expect(Math.max(...peaksFromChannelData(channel, 4))).toBe(1);
  });

  it('still returns one bar per bucket when the clip is shorter than the count', () => {
    // The guard is `Math.max(start + 1, ...)`: without it, `block < 1` makes
    // `start` and `end` collide and every bar collapses to the floor.
    const peaks = peaksFromChannelData(new Float32Array([0.9]), 6);
    expect(peaks).toHaveLength(6);
    expect(peaks[0]).toBeCloseTo(0.9, 5);
  });

  it('handles an empty channel and a non-positive count', () => {
    expect(peaksFromChannelData(new Float32Array(0), 4)).toEqual(flatPeaks(4));
    expect(peaksFromChannelData(new Float32Array([1, 1]), 0)).toEqual([]);
  });

  it('produces PEAK_SAMPLES by default', () => {
    expect(peaksFromChannelData(new Float32Array(4096))).toHaveLength(PEAK_SAMPLES);
  });
});

describe('placeholderPeaks', () => {
  it('is deterministic for a source, so the placeholder cannot flicker', () => {
    // A random pattern would reshuffle on every render and read as a glitch.
    expect(placeholderPeaks('voice/a.webm', 24)).toEqual(placeholderPeaks('voice/a.webm', 24));
  });

  it('differs between sources, so two clips do not look identical', () => {
    expect(placeholderPeaks('voice/a.webm', 24)).not.toEqual(placeholderPeaks('voice/b.webm', 24));
  });

  it('stays in the plausible-looking band', () => {
    for (const value of placeholderPeaks('voice/a.webm', 56)) {
      expect(value).toBeGreaterThanOrEqual(0.3);
      expect(value).toBeLessThanOrEqual(0.85);
    }
  });

  it('honours the requested count', () => {
    expect(placeholderPeaks('x', 0)).toEqual([]);
    expect(placeholderPeaks('x', 13)).toHaveLength(13);
  });
});

describe('flatPeaks', () => {
  it('is the same height everywhere, at the fallback amplitude', () => {
    const peaks = flatPeaks(6);
    expect(peaks).toHaveLength(6);
    expect(new Set(peaks).size).toBe(1);
    expect(peaks[0]).toBe(0.25);
  });

  it('floors a fractional or negative count', () => {
    expect(flatPeaks(0)).toEqual([]);
    expect(flatPeaks(-2)).toEqual([]);
    expect(flatPeaks(3.7)).toHaveLength(3);
  });
});
