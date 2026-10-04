/**
 * tests/voice.test.ts — unit tests for the voice recorder's pure helpers.
 * No DOM / MediaRecorder needed: mapMicError, pickMimeType, formatDuration
 * are pure functions in `lib/voice/recorder.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  mapMicError,
  pickMimeType,
} from '@/lib/voice/recorder';

function domError(name: string, message = 'boom'): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

describe('mapMicError', () => {
  it('maps NotAllowedError to permission-denied with retry instructions', () => {
    const err = mapMicError(domError('NotAllowedError'));
    expect(err.code).toBe('permission-denied');
    expect(err.retryable).toBe(true);
    expect(err.hint).toMatch(/site settings/i);
  });

  it('maps SecurityError to permission-denied', () => {
    expect(mapMicError(domError('SecurityError')).code).toBe('permission-denied');
  });

  it('maps NotFoundError to no-microphone', () => {
    const err = mapMicError(domError('NotFoundError'));
    expect(err.code).toBe('no-microphone');
    expect(err.retryable).toBe(true);
  });

  it('maps NotReadableError to device-in-use', () => {
    expect(mapMicError(domError('NotReadableError')).code).toBe('device-in-use');
  });

  it('maps OverconstrainedError to overconstrained', () => {
    expect(mapMicError(domError('OverconstrainedError')).code).toBe('overconstrained');
  });

  it('maps AbortError to aborted', () => {
    expect(mapMicError(domError('AbortError')).code).toBe('aborted');
  });

  it('maps unknown errors to unknown with the original message as hint', () => {
    const err = mapMicError(new Error('weird failure'));
    expect(err.code).toBe('unknown');
    expect(err.hint).toContain('weird failure');
    expect(err.retryable).toBe(true);
  });

  it('handles non-Error values without throwing', () => {
    expect(mapMicError(null).code).toBe('unknown');
    expect(mapMicError('nope').code).toBe('unknown');
    expect(mapMicError(undefined).code).toBe('unknown');
  });
});

describe('pickMimeType', () => {
  it('picks the first supported candidate (opus webm preferred)', () => {
    const supported = new Set(['audio/webm;codecs=opus', 'audio/mp4']);
    expect(pickMimeType((m) => supported.has(m))).toBe('audio/webm;codecs=opus');
  });

  it('falls through to later candidates', () => {
    expect(pickMimeType((m) => m === 'audio/mp4')).toBe('audio/mp4');
  });

  it('returns null when nothing is supported', () => {
    expect(pickMimeType(() => false)).toBeNull();
  });

  it('skips candidates whose probe throws', () => {
    const probe = (m: string) => {
      if (m.startsWith('audio/webm')) throw new Error('bad query');
      return m === 'audio/mp4';
    };
    expect(pickMimeType(probe)).toBe('audio/mp4');
  });
});

describe('formatDuration', () => {
  it('formats m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(999)).toBe('0:00');
    expect(formatDuration(1000)).toBe('0:01');
    expect(formatDuration(61_000)).toBe('1:01');
    expect(formatDuration(5 * 60 * 1000)).toBe('5:00');
  });

  it('clamps negatives to zero', () => {
    expect(formatDuration(-5000)).toBe('0:00');
  });
});
