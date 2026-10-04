/**
 * Notification filter taxonomy — SHARED between the API route and the client.
 *
 * Why a separate module: the client cannot import
 * `lib/services/notifications.ts` (it pulls in Prisma), and the previous
 * arrangement duplicated the mapping — the client had its own hand-written
 * `matchesFilter`, so the two could drift and the filter only ever saw the
 * rows already loaded in the browser.
 *
 * The groups deliberately mirror the preference categories in
 * Settings → Notifications (`PREF_DEFAULTS`), so a filter never surfaces a
 * notification whose matching toggle claims to control something else. In
 * particular company/team/invitation events are NOT filed under "System":
 * they are governed by the `invitations` and `announcements` toggles.
 */

export const NOTIFICATION_FILTER_VALUES = [
  'all',
  'unread',
  'likes',
  'comments',
  'follows',
  'mentions',
  'messages',
  'company',
  'system',
] as const;

export type NotificationFilter = (typeof NOTIFICATION_FILTER_VALUES)[number];

export interface NotificationFilterDef {
  value: NotificationFilter;
  label: string;
  /** Prisma `NotificationType` names. Omitted = no type restriction. */
  types?: readonly string[];
  /** Maps to the API's `unreadOnly` flag. */
  unreadOnly?: boolean;
}

export const NOTIFICATION_FILTERS: readonly NotificationFilterDef[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread', unreadOnly: true },
  { value: 'likes', label: 'Likes', types: ['LIKE'] },
  { value: 'comments', label: 'Comments', types: ['COMMENT'] },
  { value: 'follows', label: 'Follows', types: ['FOLLOW'] },
  { value: 'mentions', label: 'Mentions', types: ['MENTION'] },
  { value: 'messages', label: 'Messages', types: ['MESSAGE', 'CALL_MISSED'] },
  {
    value: 'company',
    label: 'Company',
    types: ['INVITATION_RECEIVED', 'INVITATION_ACCEPTED', 'COMPANY_ROLE_CHANGED', 'TEAM_ADDED'],
  },
  { value: 'system', label: 'System', types: ['SYSTEM', 'REPORT_STATUS'] },
];

export const DEFAULT_NOTIFICATION_FILTER: NotificationFilter = 'all';

export function isNotificationFilter(value: string | null | undefined): value is NotificationFilter {
  return (
    typeof value === 'string' &&
    (NOTIFICATION_FILTER_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Query parameters for `GET /api/notifications`.
 * Returns `{}` for "All" so the request carries no redundant params.
 */
export function notificationFilterParams(filter: NotificationFilter): {
  unreadOnly?: boolean;
  type?: string;
} {
  const def = NOTIFICATION_FILTERS.find((f) => f.value === filter);
  if (!def) return {};
  return {
    ...(def.unreadOnly ? { unreadOnly: true } : {}),
    ...(def.types ? { type: def.types.join(',') } : {}),
  };
}

/**
 * Does an individual notification belong to a filter?
 *
 * The list itself is filtered server-side. This exists for notifications that
 * arrive over the socket *after* the page loaded: they are prepended straight
 * into the list, so they have to be checked against the active filter or a
 * message would appear while the user is looking at "Likes".
 */
export function notificationMatchesFilter(
  notification: { type: string; readAt: string | null },
  filter: NotificationFilter,
): boolean {
  const def = NOTIFICATION_FILTERS.find((f) => f.value === filter);
  if (!def) return true;
  if (def.unreadOnly && notification.readAt) return false;
  if (def.types && !def.types.includes(notification.type)) return false;
  return true;
}
