/**
 * lib/desktop-notifications.ts — real OS notifications (Windows Action Center,
 * macOS Notification Center, Linux) driven by the Web Notifications API.
 *
 * WHY A MODULE STORE
 * The preference has two readers that must never disagree: the bridge that
 * fires the notifications (`components/notifications/DesktopNotificationBridge`)
 * and the toggle in Settings → Notifications. With a `useState` per component
 * the toggle would write a value the bridge never saw. One module-level value,
 * read through `useSyncExternalStore`, keeps them in step — the same shape
 * `lib/realtime/client.tsx` uses for the unread badge.
 *
 * FRAMEWORK-FREE ON PURPOSE
 * Nothing here imports React, and `Notification`, `document` and `localStorage`
 * are only ever touched behind a `typeof window` guard, so the module can be
 * imported from a server component and unit-tested in plain Node. The hook
 * lives in the component, not here.
 *
 * WHEN A NOTIFICATION IS SHOWN
 * Only when the page is NOT in front of the user — hidden tab, or the browser
 * window is not focused. That is the rule every other chat site follows, and
 * it is the reason `document.hasFocus()` is consulted as well as
 * `visibilityState`: a window that is visible but behind another app reports
 * `visible` and still deserves a notification. `show()` takes `force` for the
 * "Send a test notification" button, which must work while the tab is focused
 * or the user has no way to verify anything.
 *
 * CLICK BEHAVIOUR
 * The notification's click handler focuses the tab and dispatches
 * `avo:open-notification` with the target href. It does NOT call
 * `window.location.assign` — that would be a full page load, and the bridge
 * turns the event into a client-side `router.push` instead.
 */

/** localStorage key holding the user's on/off preference. */
export const DESKTOP_NOTIFICATION_KEY = "avo:desktop-notifications";

/** Fired on `window` when a notification is clicked. `detail.href` may be "". */
export const OPEN_NOTIFICATION_EVENT = "avo:open-notification";

export type DesktopPermission = "unsupported" | "default" | "granted" | "denied";

export interface DesktopNotificationInput {
  title: string;
  body?: string;
  /** Collapses repeats: a newer notification with the same tag replaces it. */
  tag?: string;
  icon?: string;
  /** Where a click should navigate (in-app path). */
  href?: string;
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

/**
 * `null` means "not read yet". Kept separate from the boolean so a first read
 * can be told apart from a deliberate `false`.
 */
let enabled: boolean | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Read the stored preference. Storage can throw in private mode — default on. */
function readStoredEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DESKTOP_NOTIFICATION_KEY) !== "off";
  } catch {
    return true;
  }
}

function currentEnabled(): boolean {
  if (enabled === null) enabled = readStoredEnabled();
  return enabled;
}

/** True when the user wants desktop notifications (independent of permission). */
export function isEnabled(): boolean {
  return currentEnabled();
}

/** Persist the preference and notify every subscriber. */
export function setEnabled(next: boolean): void {
  const value = next === true;
  if (currentEnabled() === value) return;
  enabled = value;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(DESKTOP_NOTIFICATION_KEY, value ? "on" : "off");
    } catch {
      /* storage unavailable — the in-memory value still applies this session */
    }
  }
  emit();
}

/**
 * Subscribe / snapshot pair for `useSyncExternalStore`.
 *
 * The snapshot is a primitive string, not a boolean: `useSyncExternalStore`
 * compares with `Object.is`, and the module also has to survive hydration —
 * the server snapshot is the constant `"off"`, which is what the markup is
 * rendered with, and the real value is picked up in the re-render that follows.
 */
export function subscribeDesktopNotifications(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDesktopNotificationsSnapshot(): string {
  return currentEnabled() ? "on" : "off";
}

export function getServerDesktopNotificationsSnapshot(): string {
  return "off";
}

/* ------------------------------------------------------------------ */
/* Permission                                                          */
/* ------------------------------------------------------------------ */

export function permissionState(): DesktopPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export function isSupported(): boolean {
  return permissionState() !== "unsupported";
}

/**
 * Ask the browser for permission. Resolves with the resulting state.
 *
 * Some browsers throw instead of resolving when the request is made outside a
 * user gesture, so the rejection is folded into `"denied"` rather than
 * propagating — the caller only ever needs the answer.
 */
export async function requestPermission(): Promise<DesktopPermission> {
  if (!isSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/* ------------------------------------------------------------------ */
/* Showing                                                             */
/* ------------------------------------------------------------------ */

/**
 * True when the user is not looking at this page: the tab is hidden, or the
 * window exists but does not have focus (e.g. the user is in another app).
 */
export function isPageInBackground(): boolean {
  if (typeof document === "undefined") return true;
  if (document.visibilityState === "hidden") return true;
  if (typeof document.hasFocus === "function") return !document.hasFocus();
  return false;
}

/**
 * Show an OS notification. Returns whether one was actually shown, so callers
 * (and tests) can tell "silently declined" from "delivered".
 */
export function show(
  input: DesktopNotificationInput,
  options: { force?: boolean } = {},
): boolean {
  if (!isSupported()) return false;
  if (Notification.permission !== "granted") return false;
  if (!options.force) {
    if (!currentEnabled()) return false;
    if (!isPageInBackground()) return false;
  }

  try {
    const notification = new Notification(input.title, {
      body: input.body,
      tag: input.tag,
      icon: input.icon,
    });

    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        /* focusing can be refused; navigation below still happens */
      }
      if (typeof window.dispatchEvent === "function") {
        window.dispatchEvent(
          new CustomEvent(OPEN_NOTIFICATION_EVENT, {
            detail: { href: input.href ?? "" },
          }),
        );
      }
      notification.close();
    };

    return true;
  } catch {
    // Constructors can throw on platforms that advertise support and then
    // refuse (some Linux desktops, or a missing notification daemon).
    return false;
  }
}
