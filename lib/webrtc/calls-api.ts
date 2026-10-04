/**
 * lib/webrtc/calls-api.ts — REST helpers for the calls endpoints.
 *
 * Privacy: every endpoint is participant-scoped server-side
 * (`lib/services/calls.ts`). The client NEVER requests another user's call
 * metadata — only `/api/calls/history` (own calls) and the call being
 * joined, where the caller/callee is a verified participant.
 */
'use client';

import { apiFetch, apiGet } from '@/lib/api-client';
import type { CallView } from '@/lib/services/serialize';

export type { CallView };

export interface InitiateCallInput {
  conversationId?: string;
  userIds?: string[];
  /** v1 client is audio-only; VIDEO is accepted but negotiated as audio. */
  type?: 'AUDIO' | 'VIDEO';
}

export type CallTransitionAction = 'accept' | 'decline' | 'end';

export interface CallHistoryPage {
  data: CallView[];
  nextCursor: string | null;
}

/** POST /api/calls — create the call record (RINGING) + participants. */
export async function initiateCallRest(
  input: InitiateCallInput,
): Promise<{ call: CallView }> {
  return apiFetch<{ call: CallView }>('/api/calls', {
    method: 'POST',
    body: {
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.userIds ? { userIds: input.userIds } : {}),
      type: input.type ?? 'AUDIO',
    },
  });
}

/** GET /api/calls/:id — participant-scoped read. */
export async function getCallRest(id: string): Promise<{ call: CallView }> {
  return apiFetch<{ call: CallView }>(`/api/calls/${encodeURIComponent(id)}`);
}

/**
 * PATCH /api/calls/:id { action } — REST fallback for accept/decline/end.
 * The realtime socket path (`call:accept` etc.) is preferred: it persists
 * AND notifies participants. Use this when the socket is down.
 */
export async function transitionCallRest(
  id: string,
  action: CallTransitionAction,
): Promise<{ call: CallView }> {
  return apiFetch<{ call: CallView }>(`/api/calls/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { action },
  });
}

/** GET /api/calls/history — only calls the viewer participated in. */
export async function fetchCallHistory(
  cursor?: string | null,
  limit = 20,
): Promise<CallHistoryPage> {
  return apiGet<CallHistoryPage>('/api/calls/history', {
    params: { limit, ...(cursor ? { cursor } : {}) },
  });
}
