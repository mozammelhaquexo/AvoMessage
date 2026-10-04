/**
 * AvoMessage realtime event catalog — SINGLE SOURCE OF TRUTH.
 *
 * Imported by BOTH:
 *   - the Socket.io server (`lib/realtime/server.ts`)
 *   - the browser client (`lib/realtime/client.tsx`)
 *
 * Never hand-write an event name or payload shape elsewhere; import from here
 * so the two sides cannot drift. All client→server payloads are validated with
 * the zod schemas below before any handler runs.
 *
 * Room scheme (see docs/ROUTES.md §6):
 *   user:{userId}         auto-joined on connect; notifications, feed fan-out,
 *                          conversation-list updates, incoming calls
 *   conversation:{id}      membership-checked join; messages, typing, receipts
 *   company:{companyId}    membership-checked join; company-scoped realtime
 *   call:{callId}          participant-checked join; signaling + participant events
 */

// ─────────────────────────────────────────────────────────────────────────────
// Room helpers
// ─────────────────────────────────────────────────────────────────────────────

export const roomUser = (userId: string): string => `user:${userId}`;
export const roomConversation = (conversationId: string): string =>
  `conversation:${conversationId}`;
export const roomCompany = (companyId: string): string => `company:${companyId}`;
export const roomCall = (callId: string): string => `call:${callId}`;

// ─────────────────────────────────────────────────────────────────────────────
// Event names
// ─────────────────────────────────────────────────────────────────────────────

/** Events the client may send to the server. */
export const ClientToServer = {
  PRESENCE_UPDATE: 'presence:update',
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
  MESSAGE_SEND: 'message:send',
  MESSAGE_DELIVERED: 'message:delivered',
  MESSAGE_READ: 'message:read',
  CONVERSATION_JOIN: 'conversation:join',
  CONVERSATION_LEAVE: 'conversation:leave',
  COMPANY_JOIN: 'company:join',
  COMPANY_LEAVE: 'company:leave',
  CALL_JOIN: 'call:join',
  CALL_LEAVE: 'call:leave',
  CALL_RING: 'call:ring',
  CALL_ACCEPT: 'call:accept',
  CALL_REJECT: 'call:reject',
  CALL_OFFER: 'call:offer',
  CALL_ANSWER: 'call:answer',
  CALL_ICE_CANDIDATE: 'call:ice-candidate',
  CALL_HANGUP: 'call:hangup',
  CALL_FAILED: 'call:failed',
} as const;

/** Events the server may send to the client. */
export const ServerToClient = {
  PRESENCE_UPDATE: 'presence:update',
  TYPING_UPDATE: 'typing:update',
  MESSAGE_NEW: 'message:new',
  MESSAGE_UPDATED: 'message:updated',
  MESSAGE_DELETED: 'message:deleted',
  MESSAGE_DELIVERED: 'message:delivered',
  MESSAGE_READ: 'message:read',
  NOTIFICATION_NEW: 'notification:new',
  FEED_POST_NEW: 'feed:post:new',
  CONVERSATION_UPDATED: 'conversation:updated',
  CALL_INCOMING: 'call:incoming',
  CALL_OFFER: 'call:offer',
  CALL_ANSWER: 'call:answer',
  CALL_ICE_CANDIDATE: 'call:ice-candidate',
  CALL_ACCEPTED: 'call:accepted',
  CALL_REJECTED: 'call:rejected',
  CALL_ENDED: 'call:ended',
  CALL_FAILED: 'call:failed',
  CALL_PARTICIPANT_JOINED: 'call:participant-joined',
  CALL_PARTICIPANT_LEFT: 'call:participant-left',
  ROOM_REVOKED: 'room:revoked',
  /** Error envelope `{ code, message }`. See ERROR_CODES. */
  ERROR: 'error',
} as const;

export type ClientToServerEvent =
  (typeof ClientToServer)[keyof typeof ClientToServer];
export type ServerToClientEvent =
  (typeof ServerToClient)[keyof typeof ServerToClient];

/** Machine-readable error codes sent on the `error` event. */
export const ERROR_CODES = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Shared value enums (mirror the Prisma enums; strings only, no TS enums)
// ─────────────────────────────────────────────────────────────────────────────

export const PRESENCE_STATUSES = [
  'ONLINE',
  'AWAY',
  'DO_NOT_DISTURB',
  'OFFLINE',
] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

/** Statuses a client is allowed to set for itself (OFFLINE is server-managed). */
export const CLIENT_SETTABLE_PRESENCE = [
  'ONLINE',
  'AWAY',
  'DO_NOT_DISTURB',
] as const;

export const MESSAGE_TYPES = [
  'TEXT',
  'IMAGE',
  'VIDEO',
  'FILE',
  'VOICE',
  'SYSTEM',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const ATTACHMENT_KINDS = ['IMAGE', 'VIDEO', 'FILE', 'VOICE'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const CALL_TYPES = ['AUDIO', 'VIDEO'] as const;
export type CallType = (typeof CALL_TYPES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// zod schemas — every client→server payload is validated against these
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

const id = z.string().min(1).max(64);

const attachmentInput = z.object({
  kind: z.enum(ATTACHMENT_KINDS),
  url: z.string().url().max(2048),
  name: z.string().max(255).optional(),
  mimeType: z.string().max(127).optional(),
  sizeBytes: z.number().int().positive().max(200 * 1024 * 1024).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const PresenceUpdateSchema = z.object({
  /** Omitted = heartbeat: touch lastSeenAt, keep current status. */
  status: z.enum(CLIENT_SETTABLE_PRESENCE).optional(),
});

export const TypingSchema = z.object({
  conversationId: id,
});

export const MessageSendSchema = z.object({
  conversationId: id,
  /** UUID (or unique token) per send attempt — retries with the same clientId
   *  are deduplicated and return the original message. */
  clientId: z.string().min(8).max(64),
  body: z.string().max(4000).optional(),
  type: z.enum(MESSAGE_TYPES).default('TEXT'),
  /** Message being replied to. Must belong to `conversationId`. */
  replyToId: id.optional(),
  /**
   * Original message when this send is a forward. MAY live in another
   * conversation — the server checks the sender can read it, because
   * forwarding must not become a way to read a message you have no access to.
   */
  forwardedFromId: id.optional(),
  attachments: z.array(attachmentInput).max(10).optional(),
});

export const MessageDeliveredSchema = z.object({
  messageId: id,
});

export const MessageReadSchema = z.object({
  conversationId: id,
  /** Read up to and including this message; omitted = mark all as read. */
  messageId: id.optional(),
});

export const ConversationJoinSchema = z.object({ conversationId: id });
export const CompanyJoinSchema = z.object({ companyId: id });
export const CallJoinSchema = z.object({ callId: id });

export const CallRingSchema = z.object({
  /** Ring an existing call (re-ring). */
  callId: id.optional(),
  /** Or create+ring a new call for a conversation… */
  conversationId: id.optional(),
  /** …or an ad-hoc set of users. */
  userIds: z.array(id).max(20).optional(),
  type: z.enum(CALL_TYPES).default('AUDIO'),
});

export const CallIdSchema = z.object({ callId: id });

const sdpPayload = z.unknown();

export const CallOfferSchema = z.object({
  callId: id,
  /** Target user; omitted = broadcast to the call room (minus sender). */
  to: id.optional(),
  sdp: sdpPayload,
});

export const CallAnswerSchema = CallOfferSchema;
export const CallIceCandidateSchema = z.object({
  callId: id,
  to: id.optional(),
  candidate: sdpPayload,
});

export const CallFailedSchema = z.object({
  callId: id,
  reason: z.string().max(255).optional(),
});

/** Maps each client→server event to its validation schema. */
export const ClientPayloadSchemas = {
  [ClientToServer.PRESENCE_UPDATE]: PresenceUpdateSchema,
  [ClientToServer.TYPING_START]: TypingSchema,
  [ClientToServer.TYPING_STOP]: TypingSchema,
  [ClientToServer.MESSAGE_SEND]: MessageSendSchema,
  [ClientToServer.MESSAGE_DELIVERED]: MessageDeliveredSchema,
  [ClientToServer.MESSAGE_READ]: MessageReadSchema,
  [ClientToServer.CONVERSATION_JOIN]: ConversationJoinSchema,
  [ClientToServer.CONVERSATION_LEAVE]: ConversationJoinSchema,
  [ClientToServer.COMPANY_JOIN]: CompanyJoinSchema,
  [ClientToServer.COMPANY_LEAVE]: CompanyJoinSchema,
  [ClientToServer.CALL_JOIN]: CallJoinSchema,
  [ClientToServer.CALL_LEAVE]: CallJoinSchema,
  [ClientToServer.CALL_RING]: CallRingSchema,
  [ClientToServer.CALL_ACCEPT]: CallIdSchema,
  [ClientToServer.CALL_REJECT]: CallIdSchema,
  [ClientToServer.CALL_OFFER]: CallOfferSchema,
  [ClientToServer.CALL_ANSWER]: CallAnswerSchema,
  [ClientToServer.CALL_ICE_CANDIDATE]: CallIceCandidateSchema,
  [ClientToServer.CALL_HANGUP]: CallIdSchema,
  [ClientToServer.CALL_FAILED]: CallFailedSchema,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Server→client payload types
// ─────────────────────────────────────────────────────────────────────────────

export interface MessageAuthorPayload {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

export interface AttachmentPayload {
  id: string;
  kind: AttachmentKind;
  url: string;
  name: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
}

/**
 * A quoted parent or forward source, carried inline on `message:new`.
 *
 * Inline rather than id-only because a forward's source can live in a
 * conversation the receiver has never loaded — an id alone would be
 * unresolvable on their client.
 */
export interface MessageQuotePayload {
  id: string;
  body: string | null;
  authorName: string | null;
  deleted: boolean;
}

export interface MessagePayload {
  id: string;
  conversationId: string;
  senderId: string | null;
  body: string | null;
  type: MessageType;
  /** Quoted parent id; kept alongside `replyTo` for backwards compatibility. */
  replyToId?: string;
  /** Inline preview of the quoted parent. */
  replyTo?: MessageQuotePayload;
  /** Inline preview of the original message when this one is a forward. */
  forwardedFrom?: MessageQuotePayload;
  createdAt: string;
  editedAt: string | null;
  author: MessageAuthorPayload | null;
  attachments: AttachmentPayload[];
}

export interface PresencePayload {
  userId: string;
  status: PresenceStatus;
  lastSeenAt: string;
}

export interface TypingPayload {
  conversationId: string;
  userId: string;
  isTyping: boolean;
}

export interface NotificationPayload {
  id: string;
  type: string;
  entityType: string | null;
  entityId: string | null;
  title: string | null;
  body: string | null;
  createdAt: string;
  actor: MessageAuthorPayload | null;
  readAt: string | null;
}

export interface FeedPostPayload {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
  author: MessageAuthorPayload | null;
  likeCount: number;
  commentCount: number;
}

export interface CallIncomingPayload {
  callId: string;
  from: string;
  fromName: string | null;
  fromAvatarUrl: string | null;
  type: CallType;
  conversationId: string | null;
}

export interface ErrorPayload {
  code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
  message: string;
}
