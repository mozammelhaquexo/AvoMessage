/**
 * lib/voice/recorder.ts — MediaRecorder wrapper for voice messages.
 *
 * `VoiceRecorder` owns the mic stream + MediaRecorder lifecycle:
 *   idle → recording → (stop → Blob | cancel → discarded)
 *
 * Pure helpers (`pickMimeType`, `mapMicError`, `formatDuration`) are exported
 * for reuse and unit-tested in `tests/voice.test.ts`.
 *
 * Limits (mirror server validation, ARCHITECTURE.md §4):
 *   max duration 5 min · max size 10 MB (checked on the produced blob).
 */

export const VOICE_MAX_DURATION_MS = 5 * 60 * 1000;
export const VOICE_MAX_BYTES = 10 * 1024 * 1024;
/** Preferred first — negotiated via MediaRecorder.isTypeSupported. */
export const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg;codecs=opus',
] as const;

/** Pick the first supported MIME type, or null when MediaRecorder is unusable. */
export function pickMimeType(
  isTypeSupported: (mime: string) => boolean,
): string | null {
  for (const mime of MIME_CANDIDATES) {
    try {
      if (isTypeSupported(mime)) return mime;
    } catch {
      // Some browsers throw on malformed queries — try the next candidate.
    }
  }
  return null;
}

/** `m:ss` — used by the recorder, player, call timer and history. */
export function formatDuration(durationMs: number): string {
  const totalSec = Math.max(0, Math.floor(durationMs / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export type MicErrorCode =
  | 'permission-denied'
  | 'no-microphone'
  | 'device-in-use'
  | 'overconstrained'
  | 'not-supported'
  | 'aborted'
  | 'too-long'
  | 'unknown';

export interface MicError {
  code: MicErrorCode;
  /** Short, user-facing title. */
  title: string;
  /** What to do about it — shown under the title. */
  hint: string;
  /** Whether pressing "record" again could plausibly succeed. */
  retryable: boolean;
}

/**
 * Map a getUserMedia / MediaRecorder failure to a structured, user-facing
 * error. Pure — safe to unit test.
 */
export function mapMicError(err: unknown): MicError {
  const name =
    err && typeof err === 'object' && 'name' in err
      ? String((err as { name: unknown }).name)
      : '';

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        code: 'permission-denied',
        title: 'Microphone access denied',
        hint: 'Allow microphone access in your browser’s site settings (click the lock/tune icon in the address bar), then try again.',
        retryable: true,
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        code: 'no-microphone',
        title: 'No microphone found',
        hint: 'Connect a microphone or headset, make sure it isn’t disabled by the OS, then try again.',
        retryable: true,
      };
    case 'NotReadableError':
    case 'TrackStartError':
      return {
        code: 'device-in-use',
        title: 'Microphone is busy',
        hint: 'Another app or browser tab is using the microphone. Close it and try again.',
        retryable: true,
      };
    case 'OverconstrainedError':
      return {
        code: 'overconstrained',
        title: 'Microphone constraints not met',
        hint: 'Your microphone doesn’t support the requested settings. Try again — we’ll fall back to defaults.',
        retryable: true,
      };
    case 'AbortError':
      return {
        code: 'aborted',
        title: 'Recording was interrupted',
        hint: 'Something interrupted the recording. Try again.',
        retryable: true,
      };
    default:
      return {
        code: 'unknown',
        title: 'Couldn’t start recording',
        hint:
          err instanceof Error && err.message
            ? err.message
            : 'An unexpected error occurred. Check your microphone and try again.',
        retryable: true,
      };
  }
}

export interface StopResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
  /** True when the 5-minute guard stopped the recording automatically. */
  autoStopped: boolean;
}

export type RecorderPhase = 'idle' | 'recording' | 'error';

/**
 * Owns getUserMedia + MediaRecorder + an AnalyserNode (for the live waveform).
 * One instance per recording session; create a new one to re-record.
 */
export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private chunks: Blob[] = [];
  private mimeType = '';
  private startedAt = 0;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private stopResolve: ((r: StopResult) => void) | null = null;
  private stopReject: ((e: unknown) => void) | null = null;
  private autoStopped = false;
  private released = false;

  phase: RecorderPhase = 'idle';
  lastError: MicError | null = null;

  /** Browser support probe — call before showing record UI. */
  static isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof MediaRecorder !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia
    );
  }

  /** Live analyser for the recording waveform; null until start() resolves. */
  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  getElapsedMs(): number {
    if (!this.startedAt) return 0;
    return Date.now() - this.startedAt;
  }

  getMimeType(): string {
    return this.mimeType;
  }

  async start(): Promise<void> {
    if (this.phase === 'recording') return;
    if (!VoiceRecorder.isSupported()) {
      this.phase = 'error';
      this.lastError = {
        code: 'not-supported',
        title: 'Recording isn’t supported here',
        hint: 'Use a recent version of Chrome, Edge, Firefox or Safari to send voice messages.',
        retryable: false,
      };
      throw this.lastError;
    }
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      this.phase = 'error';
      this.lastError = {
        code: 'not-supported',
        title: 'Microphone needs a secure connection',
        hint: 'Voice recording requires HTTPS (or localhost).',
        retryable: false,
      };
      throw this.lastError;
    }

    const mimeType =
      typeof MediaRecorder.isTypeSupported === 'function'
        ? (pickMimeType((m) => MediaRecorder.isTypeSupported(m)) ?? '')
        : '';

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      this.phase = 'error';
      this.lastError = mapMicError(err);
      throw this.lastError;
    }

    try {
      // Analyser for the live waveform (suspended until needed is fine —
      // it still receives real-time data once the context runs).
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctx) {
        this.audioCtx = new Ctx();
        const source = this.audioCtx.createMediaStreamSource(this.stream);
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.6;
        source.connect(this.analyser);
        if (this.audioCtx.state === 'suspended') {
          void this.audioCtx.resume().catch(() => undefined);
        }
      }

      this.chunks = [];
      this.mimeType = mimeType;
      this.mediaRecorder = mimeType
        ? new MediaRecorder(this.stream, { mimeType })
        : new MediaRecorder(this.stream);
      this.mediaRecorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data);
      };
      this.mediaRecorder.onerror = (e: Event) => {
        const error = (e as ErrorEvent).error ?? e;
        this.fail(error);
      };
      this.mediaRecorder.onstop = () => this.finishStop(false);
      this.autoStopped = false;
      this.mediaRecorder.start(250); // 250ms timeslices → smooth progress
      this.startedAt = Date.now();
      this.phase = 'recording';

      this.maxTimer = setTimeout(() => {
        this.autoStopped = true;
        this.stopInternal();
      }, VOICE_MAX_DURATION_MS);
    } catch (err) {
      this.release();
      this.phase = 'error';
      this.lastError = mapMicError(err);
      throw this.lastError;
    }
  }

  /**
   * Stop and resolve with the recorded audio. Rejects when the result would
   * violate limits (empty / over 10 MB) so the caller shows a real error
   * instead of uploading garbage.
   */
  stop(): Promise<StopResult> {
    return new Promise<StopResult>((resolve, reject) => {
      if (this.phase !== 'recording' || !this.mediaRecorder) {
        reject(new Error('Not recording'));
        return;
      }
      this.stopResolve = resolve;
      this.stopReject = reject;
      this.stopInternal();
    });
  }

  /** Discard the recording without producing a blob. */
  cancel(): void {
    this.stopResolve = null;
    this.stopReject = null;
    this.stopInternal();
    this.phase = 'idle';
    this.release();
  }

  private stopInternal(): void {
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
    try {
      if (
        this.mediaRecorder &&
        this.mediaRecorder.state !== 'inactive'
      ) {
        this.mediaRecorder.stop();
      } else {
        this.finishStop(false);
      }
    } catch (err) {
      this.fail(err);
    }
  }

  private finishStop(fromError: boolean): void {
    const resolve = this.stopResolve;
    const reject = this.stopReject;
    this.stopResolve = null;
    this.stopReject = null;

    const blob = new Blob(this.chunks, {
      type: this.mimeType || undefined,
    });
    const durationMs = this.startedAt ? Date.now() - this.startedAt : 0;
    this.phase = fromError ? 'error' : 'idle';
    const autoStopped = this.autoStopped;
    this.autoStopped = false;
    this.release();

    if (!resolve || !reject) return; // cancel() path — nobody is listening
    if (blob.size === 0) {
      reject(
        Object.assign(new Error('Recording produced no audio'), {
          micError: {
            code: 'unknown',
            title: 'Empty recording',
            hint: 'No audio was captured. Check your microphone and try again.',
            retryable: true,
          } satisfies MicError,
        }),
      );
      return;
    }
    if (blob.size > VOICE_MAX_BYTES) {
      reject(
        Object.assign(new Error('Recording exceeds 10 MB'), {
          micError: {
            code: 'too-long',
            title: 'Recording too large',
            hint: 'Voice messages are capped at 10 MB / 5 minutes. Try a shorter recording.',
            retryable: true,
          } satisfies MicError,
        }),
      );
      return;
    }
    resolve({
      blob,
      mimeType: blob.type || this.mimeType,
      durationMs,
      sizeBytes: blob.size,
      autoStopped,
    });
  }

  private fail(err: unknown): void {
    const reject = this.stopReject;
    this.stopResolve = null;
    this.stopReject = null;
    this.lastError = mapMicError(err);
    this.phase = 'error';
    this.release();
    reject?.(err);
  }

  private release(): void {
    if (this.released) return;
    this.released = true;
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
    try {
      this.analyser?.disconnect();
    } catch {
      /* noop */
    }
    this.analyser = null;
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => undefined);
      this.audioCtx = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.chunks = [];
    this.startedAt = 0;
  }
}
