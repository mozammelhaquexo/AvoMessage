/**
 * lib/webrtc/ice-config.ts — RTCConfiguration for AvoMessage calls.
 *
 * STUN is enough for most dev NATs; a TURN server is REQUIRED for production
 * reliability behind symmetric NATs (ARCHITECTURE.md §5).
 *
 * Client-visible env (documented in `.env.example`):
 *   NEXT_PUBLIC_STUN_URL        default "stun:stun.l.google.com:19302"
 *   NEXT_PUBLIC_TURN_URL        e.g. "turn:turn.example.com:3478"
 *   NEXT_PUBLIC_TURN_USERNAME
 *   NEXT_PUBLIC_TURN_CREDENTIAL
 *
 * SECURITY NOTE (docs/SECURITY_REVIEW.md §5): static long-lived TURN
 * credentials must never ship in the client bundle. When the call UI is
 * built, replace NEXT_PUBLIC_TURN_USERNAME/_CREDENTIAL with ephemeral
 * credentials minted by an authenticated endpoint (e.g.
 * GET /api/calls/turn-credentials returning a time-limited username +
 * HMAC-derived password per the TURN REST API scheme), and keep the TURN
 * shared secret server-side only.
 */
'use client';

export interface IceSettings {
  stunUrl: string;
  turnUrl?: string;
  turnUsername?: string;
  turnCredential?: string;
}

export function readIceSettings(): IceSettings {
  // `process.env` may be absent in some bundler contexts; type the lookup
  // loosely so client builds without NEXT_PUBLIC_* vars still compile.
  const env: Record<string, string | undefined> =
    typeof process !== 'undefined' && process.env ? process.env : {};
  return {
    stunUrl:
      env.NEXT_PUBLIC_STUN_URL?.trim() || 'stun:stun.l.google.com:19302',
    turnUrl: env.NEXT_PUBLIC_TURN_URL?.trim() || undefined,
    turnUsername: env.NEXT_PUBLIC_TURN_USERNAME?.trim() || undefined,
    turnCredential: env.NEXT_PUBLIC_TURN_CREDENTIAL?.trim() || undefined,
  };
}

export function buildIceConfig(settings: IceSettings = readIceSettings()): RTCConfiguration {
  const iceServers: RTCIceServer[] = [{ urls: settings.stunUrl }];
  if (settings.turnUrl && settings.turnUsername && settings.turnCredential) {
    iceServers.push({
      urls: settings.turnUrl,
      username: settings.turnUsername,
      credential: settings.turnCredential,
    });
  }
  return { iceServers };
}

/** True when a TURN relay is configured (production-grade NAT traversal). */
export function hasTurnRelay(settings: IceSettings = readIceSettings()): boolean {
  return Boolean(settings.turnUrl && settings.turnUsername && settings.turnCredential);
}
