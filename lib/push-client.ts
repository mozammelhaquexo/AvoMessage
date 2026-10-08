/**
 * lib/push-client.ts — browser side of Web Push.
 *
 * WHAT THIS FILE IS FOR
 * Everything needed to make a browser able to receive a notification while the
 * tab is CLOSED:
 *
 *   1. register the service worker (`public/sw.js`),
 *   2. obtain a `PushSubscription` from the browser's push service,
 *   3. hand that endpoint to the server so it can push to it,
 *   4. hand the service worker a CSRF token, because the worker cannot read
 *      cookies and therefore cannot satisfy the double-submit check on its own.
 *
 * WHY (4) IS NECESSARY RATHER THAN CLEVER
 * `assertCsrf` compares the `x-csrf-token` header against the `avo_csrf`
 * cookie. A service worker has no `document`, so it cannot read that cookie —
 * `document.cookie` does not exist in its scope. Without a token, the worker's
 * re-subscribe would be refused with 403 and a rotated subscription would be
 * lost silently. Cache Storage is the one same-origin store both sides can
 * reach, so the page parks the token there and the worker reads it back.
 *
 * Exempting the route from CSRF instead would be the wrong trade: the endpoint
 * and its keys decide WHERE a user's message notifications are delivered, so an
 * unauthenticated cross-site POST could redirect them to an attacker's server.
 *
 * FRAMEWORK-FREE. No React, no imports from `lib/services/*`. Everything is
 * behind a `typeof window` guard so importing this module on the server (or in
 * a test) is safe.
 */

import { apiDelete, apiGet, apiPost, getCsrfToken } from "./api-client";

/** Served verbatim from `public/`. Never bundled. */
export const SERVICE_WORKER_URL = "/sw.js";

/** Same-origin Cache the page uses to hand the CSRF token to the worker. */
export const CSRF_CACHE_NAME = "avo-sw-handoff";
export const CSRF_CACHE_KEY = "/__avo-csrf";

export type PushSetupResult =
  | "subscribed"
  | "unsupported"
  | "denied"
  | "disabled"
  | "error";

interface PublicKeyResponse {
  publicKey: string | null;
}

interface SubscribeResponse {
  ok: boolean;
  id?: string;
}

/* ------------------------------------------------------------------ */
/* Capability                                                          */
/* ------------------------------------------------------------------ */

/**
 * True when this browser can do Web Push at all.
 *
 * All three are required and each is absent somewhere: Safari < 16 has no
 * `PushManager`, Firefox on desktop has it but a private window refuses,
 * and `Notification` is missing in a non-secure context. `isSecureContext` is
 * checked separately because `serviceWorker` exists but registering throws on
 * plain HTTP (other than localhost).
 */
export function pushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    window.isSecureContext === true
  );
}

/** Permission as the browser reports it, without prompting. */
export function permissionState(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/* ------------------------------------------------------------------ */
/* Service worker                                                      */
/* ------------------------------------------------------------------ */

/**
 * Register the worker (idempotent) and wait until it is controlling.
 *
 * `register()` on an already-registered script is a no-op that returns the
 * existing registration, so calling it on every load is the intended usage —
 * that is also how a changed `sw.js` gets picked up.
 */
export async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
      scope: "/",
    });
    // `ready` resolves once there is an ACTIVE worker, which is what
    // `pushManager` lives on. On a first visit that is after activation.
    await navigator.serviceWorker.ready;
    return registration;
  } catch (error) {
    // A CSP violation lands here, and it looks exactly like "push does not
    // work" with nothing in the app's own logs. See `worker-src` in proxy.ts.
    console.error("[push] service worker registration failed", error);
    return null;
  }
}

/**
 * Park the CSRF token where the service worker can find it.
 *
 * Best-effort: if Cache Storage is unavailable the worker's re-subscribe path
 * simply fails and the next page load re-syncs, which is the same outcome as
 * not having the handler at all.
 */
export async function publishCsrfToken(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  const token = getCsrfToken();
  if (!token) return;
  try {
    const cache = await caches.open(CSRF_CACHE_NAME);
    await cache.put(CSRF_CACHE_KEY, new Response(token, { headers: { "Content-Type": "text/plain" } }));
  } catch {
    /* storage unavailable — the page-load sync still covers rotation */
  }
}

/* ------------------------------------------------------------------ */
/* Subscription                                                        */
/* ------------------------------------------------------------------ */

/**
 * VAPID public keys arrive base64url-encoded; `subscribe()` wants raw bytes.
 * `-`/`_` are the URL-safe alphabet and the `=` padding is optional, so both
 * have to be restored before `atob` will accept the string.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** The endpoint this browser currently holds, if any. */
async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await getRegistration();
  if (!registration) return null;
  try {
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Make sure this browser has a subscription the server knows about.
 *
 * MUST BE CALLED FROM A USER GESTURE when permission has not been decided yet:
 * `Notification.requestPermission()` outside one is ignored or rejected by
 * every current browser. Calling it later (permission already granted) needs no
 * gesture, which is what lets the app re-sync on load.
 */
export async function ensureSubscription(): Promise<PushSetupResult> {
  if (!pushSupported()) return "unsupported";

  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      return "denied";
    }
  }
  if (Notification.permission !== "granted") return "denied";

  const registration = await getRegistration();
  if (!registration) return "error";

  const publicKey = await apiGet<PublicKeyResponse>("/api/push/public-key")
    .then((r) => r.publicKey)
    .catch(() => null);
  if (!publicKey) return "disabled";

  let subscription = await currentSubscription();
  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    } catch (error) {
      console.error("[push] subscribe failed", error);
      return "error";
    }
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return "error";

  await publishCsrfToken();

  try {
    await apiPost<SubscribeResponse>("/api/push/subscribe", {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
  } catch (error) {
    console.error("[push] could not register the subscription", error);
    return "error";
  }

  // The page bridge reads this to decide whether to stand down; without the
  // invalidation it would keep its "no push" answer for another 30 seconds and
  // double up on the very next message.
  invalidateActivePushCache();
  return "subscribed";
}

/**
 * Drop the subscription locally and on the server.
 *
 * The local `unsubscribe()` is what stops the browser delivering; the server
 * call is what stops US sending. Both are needed — leaving the server row
 * behind means every message still pays for a push nobody receives.
 */
export async function releaseSubscription(): Promise<void> {
  if (typeof window === "undefined") return;
  const subscription = await currentSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;

  await publishCsrfToken();
  await apiDelete<{ ok: boolean }>("/api/push/subscribe", { endpoint }).catch(() => null);
  await subscription.unsubscribe().catch(() => null);
  // The page bridge has to take over again from the next message.
  invalidateActivePushCache();
}

/**
 * Quietly re-point the server at whatever subscription this browser holds.
 *
 * Runs on every app load, with no prompt and no user-visible failure: a browser
 * may have rotated the endpoint while no tab was open, and a rotated endpoint
 * that the server does not know about means notifications stop with no error
 * anywhere. `POST /api/push/subscribe` is an upsert, so the steady-state cost
 * is one small request per page load.
 */
export async function syncSubscription(): Promise<void> {
  if (!pushSupported()) return;
  if (Notification.permission !== "granted") return;
  await publishCsrfToken();

  const subscription = await currentSubscription();
  if (!subscription) return;
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

  await apiPost<SubscribeResponse>("/api/push/subscribe", {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  }).catch(() => null);
}

/**
 * Show a notification through the SERVICE WORKER rather than the page.
 *
 * `new Notification(...)` (lib/desktop-notifications.ts) is bound to the
 * document that created it and disappears with the tab; a notification shown
 * via the registration outlives the page. Used by the "Send a test
 * notification" button so what the user tests is the same code path that
 * delivers real ones.
 */
export async function showViaServiceWorker(
  title: string,
  options: NotificationOptions = {},
): Promise<boolean> {
  const registration = await getRegistration();
  if (!registration) return false;
  try {
    await registration.showNotification(title, {
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      ...options,
    });
    return true;
  } catch (error) {
    console.error("[push] showNotification failed", error);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Who owns the banner                                                 */
/* ------------------------------------------------------------------ */

/** Result of the last check, with the time it was made. */
let activeCache: { value: boolean; at: number } | null = null;

/**
 * How long a "no subscription" answer is trusted. Short, because the answer
 * changes the moment the user flips the settings switch; long enough that a
 * burst of messages does not repeat the lookup for every one of them.
 */
const ACTIVE_TTL_MS = 30_000;

/**
 * True when this browser holds a push subscription — meaning the SERVICE
 * WORKER will show message banners, and the in-page bridge must not.
 *
 * WHY THIS EXISTS. There are two ways a banner can be produced: the worker
 * (which survives a closed tab) and `DesktopNotificationBridge` (page
 * JavaScript). Both react to the same message, so without a tie-break the user
 * gets two banners for one message — different `tag` values, so they do not
 * even collapse into one. The worker is the more capable of the two, so when it
 * is available the page stands down.
 *
 * The lookup is deliberately NOT done once at mount: on the very first visit
 * the subscription does not exist yet, and caching that answer would leave the
 * page claiming ownership forever. It is re-checked lazily with a short TTL.
 */
export async function hasActivePushSubscription(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (activeCache && Date.now() - activeCache.at < ACTIVE_TTL_MS) return activeCache.value;

  let value = false;
  if (pushSupported() && Notification.permission === "granted") {
    value = (await currentSubscription()) !== null;
  }
  activeCache = { value, at: Date.now() };
  return value;
}

/** Drop the cached answer — call right after subscribing or unsubscribing. */
export function invalidateActivePushCache(): void {
  activeCache = null;
}
