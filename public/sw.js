/**
 * public/sw.js — AvoMessage service worker.
 *
 * THE ONLY REASON THIS FILE EXISTS
 * A notification from page JavaScript (`new Notification(...)`, see
 * `lib/desktop-notifications.ts`) needs a live document. Close the tab and the
 * code that would show it is gone — so "notify me when a message arrives" can
 * never work that way. A service worker is the one script the browser keeps
 * running after the last tab closes, and the browser's push service wakes it
 * to deliver a `push` event. `self.registration.showNotification()` from here
 * is what produces the Chrome-style notification with the tab closed.
 *
 * It is written in plain ES5-ish JavaScript on purpose: this file is served
 * verbatim from `public/`, never compiled by Next, so it must run as-is in
 * every browser that can register a worker.
 *
 * TWO JOBS
 *   1. `push`               → show the notification (or stay quiet if the user
 *                             is already looking at that exact conversation).
 *   2. `notificationclick`  → focus the tab that is already open, or open a new
 *                             one at the message's URL. Never a duplicate tab.
 */

/* eslint-disable no-undef */

/** Keep one notification per conversation; a newer one replaces the older. */
const DEFAULT_TAG = 'avomessage';

/**
 * Is the user already looking at this conversation in a focused tab?
 *
 * Showing a banner for a message the user is watching arrive is the single
 * most annoying thing a chat app can do. The check is done here rather than on
 * the server because only the worker can see the client list.
 *
 * A focused client on a DIFFERENT conversation still gets the notification —
 * that is the whole point of the feature.
 */
async function isConversationVisible(url) {
  try {
    const target = new URL(url, self.location.origin);
    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    return clients.some((client) => {
      if (client.focused !== true || client.visibilityState !== 'visible') return false;
      try {
        return new URL(client.url).pathname === target.pathname;
      } catch {
        return false;
      }
    });
  } catch {
    // If the client list cannot be read, err towards showing the notification:
    // a duplicate banner is a smaller failure than a missed message.
    return false;
  }
}

/** Badge the app icon on platforms that support it (Chrome/Edge, Android). */
async function setBadge(count) {
  try {
    if (typeof count !== 'number' || count <= 0) {
      if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
      return;
    }
    if (self.navigator.setAppBadge) await self.navigator.setAppBadge(count);
  } catch {
    /* badge support is optional; never let it break delivery */
  }
}

self.addEventListener('install', (event) => {
  // Take over immediately rather than waiting for every tab to close — a user
  // who has just granted notification permission expects it to work now.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let payload = null;
      try {
        payload = event.data ? event.data.json() : null;
      } catch {
        // A malformed or empty payload still deserves a notification: the user
        // has a message waiting and no way to know it.
        payload = null;
      }

      const title = (payload && payload.title) || 'New message';
      const url = (payload && payload.url) || '/messages';
      const body = (payload && payload.body) || 'You have a new message on AvoMessage.';

      if (await isConversationVisible(url)) {
        // Seen live — keep the badge current but do not interrupt.
        if (payload && typeof payload.badgeCount === 'number') {
          await setBadge(payload.badgeCount);
        }
        return;
      }

      const options = {
        body,
        icon: (payload && payload.icon) || '/icon-192.png',
        badge: '/icon-192.png',
        // One notification per conversation: a burst collapses into the newest
        // instead of stacking a column of banners.
        tag: (payload && payload.tag) || DEFAULT_TAG,
        // `renotify` is what makes a replaced notification alert AGAIN. Without
        // it the second and later messages of a burst arrive silently, which
        // reads as "notifications are broken".
        renotify: true,
        requireInteraction: payload ? payload.requireInteraction !== false : true,
        silent: false,
        vibrate: [200, 100, 200],
        timestamp: Date.now(),
        dir: 'auto',
        data: { url },
        actions: [{ action: 'open', title: 'Open' }],
      };

      await self.registration.showNotification(title, options);

      if (payload && typeof payload.badgeCount === 'number') {
        await setBadge(payload.badgeCount);
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'close') return;

  const target =
    (event.notification.data && event.notification.data.url) || '/messages';

  event.waitUntil(
    (async () => {
      const absolute = new URL(target, self.location.origin).href;
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Reuse a tab that is already on this origin — opening a second copy of
      // the app is the classic push-notification bug.
      for (const client of clients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          if ('navigate' in client) await client.navigate(absolute);
          if ('focus' in client) return await client.focus();
        } catch {
          /* fall through to opening a new window */
        }
      }

      if (self.clients.openWindow) await self.clients.openWindow(absolute);
    })(),
  );
});

/**
 * The browser rotates a subscription on its own schedule. Re-subscribing here
 * is what keeps notifications working months after the user enabled them, with
 * no page open to notice the change.
 *
 * The CSRF token comes from a same-origin Cache the page wrote — a worker has
 * no `document` and therefore cannot read the `avo_csrf` cookie. Without it
 * this POST is refused with 403 and the rotation is lost; the next page load
 * repairs it, which is the same outcome as not having this handler.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const response = await fetch('/api/push/public-key', {
          credentials: 'include',
        });
        if (!response.ok) return;
        const { publicKey } = await response.json();
        if (!publicKey) return;

        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        const json = subscription.toJSON();

        const csrf = await readCsrfToken();
        const headers = { 'Content-Type': 'application/json' };
        if (csrf) headers['x-csrf-token'] = csrf;

        await fetch('/api/push/subscribe', {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
        });
      } catch {
        /* the next page load re-syncs the subscription anyway */
      }
    })(),
  );
});

/** Read the CSRF token the page parked in Cache Storage. */
async function readCsrfToken() {
  try {
    const cache = await caches.open('avo-sw-handoff');
    const response = await cache.match('/__avo-csrf');
    if (!response) return null;
    const token = await response.text();
    return token || null;
  } catch {
    return null;
  }
}

/** VAPID keys travel as base64url; `subscribe()` wants raw bytes. */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}
