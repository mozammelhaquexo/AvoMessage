/**
 * lib/desktop-notifications.ts — the OS-notification core.
 *
 * The module is framework-free and reads `window`, `document`, `Notification`
 * and `localStorage` lazily, so a plain global stub is enough to exercise it in
 * the node test environment. Each test re-imports it (`vi.resetModules`) because
 * the on/off preference is deliberately module state — one value shared by the
 * Settings toggle and the bridge that fires the notifications.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DesktopNotificationInput,
  DesktopPermission,
} from '@/lib/desktop-notifications';

interface BrowserOptions {
  /** `Notification.permission`. Omit to make `Notification` undefined. */
  permission?: DesktopPermission;
  visibility?: 'visible' | 'hidden';
  focused?: boolean;
  /** Pre-seeded localStorage value for the preference key. */
  stored?: string;
}

interface Browser {
  created: { title: string; options: Record<string, unknown> | undefined }[];
  /** The live instances, so a test can fire `onclick`. */
  instances: { onclick: (() => void) | null; close: ReturnType<typeof vi.fn> }[];
  dispatch: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
}

const KEY = 'avo:desktop-notifications';

let restore: (() => void) | null = null;

function installBrowser(options: BrowserOptions = {}): Browser {
  // Undo any stub a previous call inside the SAME test installed, so `restore`
  // always points at the real globals rather than at another stub.
  restore?.();
  restore = null;

  const created: Browser['created'] = [];
  const instances: Browser['instances'] = [];
  const storage = new Map<string, string>();
  if (options.stored !== undefined) storage.set(KEY, options.stored);

  const dispatch = vi.fn();
  const requestPermission = vi.fn(async () => options.permission ?? 'denied');

  class FakeNotification {
    static permission: DesktopPermission = options.permission ?? 'denied';
    static requestPermission = requestPermission;
    onclick: (() => void) | null = null;
    close = vi.fn();
    constructor(title: string, opts?: Record<string, unknown>) {
      created.push({ title, options: opts });
      instances.push(this);
    }
  }

  const windowStub: Record<string, unknown> = {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
    },
    dispatchEvent: dispatch,
    focus: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  const documentStub = {
    visibilityState: options.visibility ?? 'visible',
    hasFocus: () => options.focused ?? true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = {
    window: globals.window,
    document: globals.document,
    Notification: globals.Notification,
    CustomEvent: globals.CustomEvent,
  };

  // In a browser `window === globalThis` and `Notification` hangs off it, which
  // is exactly what `permissionState()` tests for (`"Notification" in window`).
  // The stub has to mirror that or the module correctly reports "unsupported".
  if (options.permission === undefined) {
    delete globals.Notification;
  } else {
    globals.Notification = FakeNotification;
    windowStub.Notification = FakeNotification;
  }

  globals.window = windowStub;
  globals.document = documentStub;
  // Node 22 has CustomEvent; the stub is only a fallback for older runtimes.
  if (typeof globals.CustomEvent !== 'function') {
    globals.CustomEvent = class {
      constructor(
        public type: string,
        public init?: { detail?: unknown },
      ) {}
      get detail() {
        return this.init?.detail;
      }
    };
  }

  restore = () => {
    globals.window = previous.window;
    globals.document = previous.document;
    globals.Notification = previous.Notification;
    globals.CustomEvent = previous.CustomEvent;
  };

  return { created, instances, dispatch, requestPermission };
}

/** Fresh copy of the module, so its cached preference starts from storage. */
async function load() {
  vi.resetModules();
  return import('@/lib/desktop-notifications');
}

const MESSAGE: DesktopNotificationInput = {
  title: 'Alice',
  body: 'hey',
  tag: 'avo-conv:c1',
  href: '/messages/c1',
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  restore?.();
  restore = null;
  vi.restoreAllMocks();
});

describe('desktop notifications — permission', () => {
  it('reports unsupported when the browser has no Notification constructor', async () => {
    installBrowser({ permission: undefined });
    const mod = await load();
    expect(mod.isSupported()).toBe(false);
    expect(mod.permissionState()).toBe('unsupported');
  });

  it('never shows anything without permission', async () => {
    const browser = installBrowser({ permission: 'denied', visibility: 'hidden', focused: false });
    const mod = await load();

    expect(mod.show(MESSAGE)).toBe(false);
    expect(browser.created).toHaveLength(0);
  });

  it('asks once, and only while the answer is still "default"', async () => {
    const browser = installBrowser({ permission: 'default' });
    const mod = await load();

    expect(await mod.requestPermission()).toBe('default');
    expect(browser.requestPermission).toHaveBeenCalledTimes(1);

    // A decided permission is returned straight from the browser, without a
    // second prompt — Chrome ignores repeat requests and the UI would look
    // broken if it waited on one.
    const granted = installBrowser({ permission: 'granted' });
    const mod2 = await load();
    expect(await mod2.requestPermission()).toBe('granted');
    expect(granted.requestPermission).not.toHaveBeenCalled();
  });
});

describe('desktop notifications — when one is shown', () => {
  it('shows nothing while the page is in front of the user', async () => {
    const browser = installBrowser({ permission: 'granted', visibility: 'visible', focused: true });
    const mod = await load();

    expect(mod.show(MESSAGE)).toBe(false);
    expect(browser.created).toHaveLength(0);
  });

  it('shows one when the tab is hidden', async () => {
    const browser = installBrowser({ permission: 'granted', visibility: 'hidden', focused: true });
    const mod = await load();

    expect(mod.show(MESSAGE)).toBe(true);
    expect(browser.created).toHaveLength(1);
    expect(browser.created[0].title).toBe('Alice');
    expect(browser.created[0].options).toMatchObject({ body: 'hey', tag: 'avo-conv:c1' });
  });

  it('shows one when the window is visible but not focused', async () => {
    // The common case on a desktop: the browser is open behind the app the
    // user is actually working in. `visibilityState` still says "visible", so
    // focus is what has to decide it.
    const browser = installBrowser({ permission: 'granted', visibility: 'visible', focused: false });
    const mod = await load();

    expect(mod.show(MESSAGE)).toBe(true);
    expect(browser.created).toHaveLength(1);
  });

  it('honours the stored preference', async () => {
    const browser = installBrowser({
      permission: 'granted',
      visibility: 'hidden',
      focused: false,
      stored: 'off',
    });
    const mod = await load();

    expect(mod.isEnabled()).toBe(false);
    expect(mod.show(MESSAGE)).toBe(false);
    expect(browser.created).toHaveLength(0);
  });

  it('force overrides both the preference and the focus check', async () => {
    // This is the "Send a test" button: the whole point is to be pressable
    // while the tab is in front of the user.
    const browser = installBrowser({
      permission: 'granted',
      visibility: 'visible',
      focused: true,
      stored: 'off',
    });
    const mod = await load();

    expect(mod.show(MESSAGE, { force: true })).toBe(true);
    expect(browser.created).toHaveLength(1);
  });

  it('routes a click back into the app instead of reloading it', async () => {
    const browser = installBrowser({ permission: 'granted', visibility: 'hidden', focused: false });
    const mod = await load();

    expect(mod.show(MESSAGE)).toBe(true);
    const notification = browser.instances[0];
    expect(notification).toBeDefined();
    expect(typeof notification.onclick).toBe('function');

    notification.onclick?.();

    // A custom event, not `window.location.assign`: a notification click must
    // land in the running SPA, not reload the whole page.
    expect(browser.dispatch).toHaveBeenCalledTimes(1);
    const event = browser.dispatch.mock.calls[0][0] as {
      type: string;
      detail?: { href?: string };
    };
    expect(event.type).toBe('avo:open-notification');
    expect(event.detail?.href).toBe('/messages/c1');
    expect(notification.close).toHaveBeenCalled();
  });

  it('dispatches an empty href when the notification has no target', async () => {
    const browser = installBrowser({ permission: 'granted', visibility: 'hidden', focused: false });
    const mod = await load();

    mod.show({ title: 'AvoMessage', body: 'no target' });
    browser.instances[0].onclick?.();

    const event = browser.dispatch.mock.calls[0][0] as { detail?: { href?: string } };
    expect(event.detail?.href).toBe('');
  });
});

describe('desktop notifications — the preference store', () => {
  it('persists the choice and notifies subscribers', async () => {
    installBrowser({ permission: 'granted', stored: 'on' });
    const mod = await load();

    const listener = vi.fn();
    const unsubscribe = mod.subscribeDesktopNotifications(listener);

    expect(mod.getDesktopNotificationsSnapshot()).toBe('on');
    mod.setEnabled(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(mod.getDesktopNotificationsSnapshot()).toBe('off');

    // A no-op write must not wake anybody up — the switch and the bridge both
    // subscribe, and a spurious notification would re-render the whole shell.
    mod.setEnabled(false);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    mod.setEnabled(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(mod.getDesktopNotificationsSnapshot()).toBe('on');
  });

  it('defaults to on, so a granted permission starts working immediately', async () => {
    installBrowser({ permission: 'granted' });
    const mod = await load();
    expect(mod.isEnabled()).toBe(true);
  });

  it('survives a browser that refuses storage access', async () => {
    const browser = installBrowser({ permission: 'granted', visibility: 'hidden', focused: false });
    const globals = globalThis as unknown as { window: { localStorage: unknown } };
    globals.window.localStorage = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    const mod = await load();

    // Private mode: the preference cannot be read, so the default (on) holds
    // and writing it must not throw.
    expect(mod.isEnabled()).toBe(true);
    expect(() => mod.setEnabled(false)).not.toThrow();
    expect(browser.created).toHaveLength(0);
  });
  it('serves the server snapshot as "off" so hydration cannot mismatch', async () => {
    installBrowser({ permission: 'granted', stored: 'on' });
    const mod = await load();
    expect(mod.getServerDesktopNotificationsSnapshot()).toBe('off');
    expect(mod.getDesktopNotificationsSnapshot()).toBe('on');
  });
});
