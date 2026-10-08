/**
 * lib/push-client.ts — the browser side of Web Push.
 *
 * Two things are worth testing here, and they are the two that are easy to get
 * silently wrong:
 *
 *   1. `urlBase64ToUint8Array` — the VAPID public key arrives base64URL-encoded
 *      and `pushManager.subscribe()` wants raw bytes. Get the alphabet or the
 *      padding wrong and the browser rejects the subscription with an opaque
 *      error, so this is checked against `atob` rather than against a
 *      hand-copied expectation.
 *
 *   2. `hasActivePushSubscription` — the tie-break that stops the in-page
 *      bridge and the service worker from BOTH showing a banner for the same
 *      message. It must answer "no" whenever the browser cannot push, and it
 *      must cache, because it is consulted on the hot path of every incoming
 *      message.
 *
 * The module keeps its cache in module state, so each test re-imports it —
 * the same pattern tests/desktop-notifications.test.ts uses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/* Browser stub                                                        */
/* ------------------------------------------------------------------ */

interface StubOptions {
  /** Omit to leave `window` undefined (server-side import). */
  browser?: boolean;
  secure?: boolean;
  permission?: NotificationPermission;
  /** Endpoint the registration reports, or null for "no subscription". */
  endpoint?: string | null;
  /** Omit to leave `serviceWorker` off `navigator` entirely. */
  withServiceWorker?: boolean;
}

interface Stub {
  getSubscription: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
}

let restore: (() => void) | null = null;

function installBrowser(options: StubOptions = {}): Stub {
  restore?.();
  restore = null;

  const getSubscription = vi.fn(async () =>
    options.endpoint ? { endpoint: options.endpoint, toJSON: () => ({}) } : null,
  );
  const register = vi.fn(async () => ({
    pushManager: { getSubscription },
  }));

  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = {
    window: globals.window,
    navigator: globals.navigator,
    Notification: globals.Notification,
    atob: globals.atob,
  };

  if (options.browser) {
    const win: Record<string, unknown> = {
      isSecureContext: options.secure ?? true,
    };
    if (options.withServiceWorker !== false) win.PushManager = function PushManager() {};

    const nav: Record<string, unknown> = {};
    if (options.withServiceWorker !== false) nav.serviceWorker = { register, ready: Promise.resolve() };

    // `Notification` has to exist on BOTH: `pushSupported()` asks
    // `'Notification' in window`, while the module reads the bare global
    // `Notification.permission`. A real browser has one object that is both.
    const notification = { permission: options.permission ?? 'default' };
    win.Notification = notification;

    globals.window = win;
    globals.navigator = nav;
    globals.Notification = notification;
  } else {
    delete globals.window;
    delete globals.navigator;
    delete globals.Notification;
  }

  restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globals[key];
      else globals[key] = value;
    }
  };

  return { getSubscription, register };
}

/** Import a fresh copy so the module-level cache starts empty. */
async function loadModule() {
  vi.resetModules();
  return import('@/lib/push-client');
}

afterEach(() => {
  restore?.();
  restore = null;
});

/* ------------------------------------------------------------------ */
/* Key decoding                                                        */
/* ------------------------------------------------------------------ */

describe('urlBase64ToUint8Array', () => {
  it('decodes a plain base64url string', async () => {
    const { urlBase64ToUint8Array } = await loadModule();

    // "hello" -> base64 "aGVsbG8=" -> base64url "aGVsbG8"
    expect(Array.from(urlBase64ToUint8Array('aGVsbG8'))).toEqual([104, 101, 108, 108, 111]);
  });

  it('restores the +/ alphabet from the URL-safe -_ form', async () => {
    const { urlBase64ToUint8Array } = await loadModule();

    const expected = Array.from(atob('+/+/'), (c) => c.charCodeAt(0));
    expect(Array.from(urlBase64ToUint8Array('-_-_'))).toEqual(expected);
  });

  it('adds the padding atob requires', async () => {
    const { urlBase64ToUint8Array } = await loadModule();

    // 4 characters is unpadded for 3 bytes; 2 characters needs "==" appended.
    const twoChars = urlBase64ToUint8Array('aG');
    expect(Array.from(twoChars)).toEqual(Array.from(atob('aG=='), (c) => c.charCodeAt(0)));
  });

  it('accepts an already-padded string', async () => {
    const { urlBase64ToUint8Array } = await loadModule();

    expect(Array.from(urlBase64ToUint8Array('aGVsbG8='))).toEqual([104, 101, 108, 108, 111]);
  });

  it('produces exactly the bytes of a realistic VAPID key', async () => {
    const { urlBase64ToUint8Array } = await loadModule();

    // 65-byte uncompressed P-256 point, the shape a real key has.
    const key = Buffer.alloc(65, 7).toString('base64url');
    const bytes = urlBase64ToUint8Array(key);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(7);
    expect(bytes[64]).toBe(7);
  });
});

/* ------------------------------------------------------------------ */
/* Capability                                                          */
/* ------------------------------------------------------------------ */

describe('pushSupported', () => {
  it('is false on the server', async () => {
    installBrowser({ browser: false });
    const { pushSupported } = await loadModule();
    expect(pushSupported()).toBe(false);
  });

  it('is true in a secure context with a worker and PushManager', async () => {
    installBrowser({ browser: true, secure: true });
    const { pushSupported } = await loadModule();
    expect(pushSupported()).toBe(true);
  });

  it('is false on a non-secure origin', async () => {
    installBrowser({ browser: true, secure: false });
    const { pushSupported } = await loadModule();
    expect(pushSupported()).toBe(false);
  });

  it('is false when the browser has no service worker', async () => {
    installBrowser({ browser: true, withServiceWorker: false });
    const { pushSupported } = await loadModule();
    expect(pushSupported()).toBe(false);
  });
});

describe('permissionState', () => {
  it('reports unsupported without a browser', async () => {
    installBrowser({ browser: false });
    const { permissionState } = await loadModule();
    expect(permissionState()).toBe('unsupported');
  });

  it('reports the browser value', async () => {
    installBrowser({ browser: true, permission: 'granted' });
    const { permissionState } = await loadModule();
    expect(permissionState()).toBe('granted');
  });
});

/* ------------------------------------------------------------------ */
/* The tie-break                                                       */
/* ------------------------------------------------------------------ */

describe('hasActivePushSubscription', () => {
  it('is false on the server', async () => {
    installBrowser({ browser: false });
    const { hasActivePushSubscription } = await loadModule();
    expect(await hasActivePushSubscription()).toBe(false);
  });

  it('is false when permission was never granted', async () => {
    const stub = installBrowser({ browser: true, permission: 'default', endpoint: 'https://push/x' });
    const { hasActivePushSubscription } = await loadModule();

    expect(await hasActivePushSubscription()).toBe(false);
    // No point asking the browser for a subscription it cannot have.
    expect(stub.getSubscription).not.toHaveBeenCalled();
  });

  it('is true when permission is granted and a subscription exists', async () => {
    installBrowser({ browser: true, permission: 'granted', endpoint: 'https://push/x' });
    const { hasActivePushSubscription } = await loadModule();

    expect(await hasActivePushSubscription()).toBe(true);
  });

  it('is false when permission is granted but no subscription exists', async () => {
    installBrowser({ browser: true, permission: 'granted', endpoint: null });
    const { hasActivePushSubscription } = await loadModule();

    expect(await hasActivePushSubscription()).toBe(false);
  });

  it('caches the answer so a burst of messages does not re-query', async () => {
    const stub = installBrowser({ browser: true, permission: 'granted', endpoint: 'https://push/x' });
    const { hasActivePushSubscription } = await loadModule();

    await hasActivePushSubscription();
    await hasActivePushSubscription();
    await hasActivePushSubscription();

    expect(stub.getSubscription).toHaveBeenCalledTimes(1);
  });

  it('forgets the cached answer when asked to', async () => {
    const stub = installBrowser({ browser: true, permission: 'granted', endpoint: 'https://push/x' });
    const { hasActivePushSubscription, invalidateActivePushCache } = await loadModule();

    await hasActivePushSubscription();
    invalidateActivePushCache();
    await hasActivePushSubscription();

    expect(stub.getSubscription).toHaveBeenCalledTimes(2);
  });
});
