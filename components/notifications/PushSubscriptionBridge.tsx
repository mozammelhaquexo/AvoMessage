/**
 * components/notifications/PushSubscriptionBridge.tsx — keeps the server's
 * push endpoints in step with this browser.
 *
 * Mounted once inside `AppShell`, next to `DesktopNotificationBridge`. Renders
 * nothing; it exists for one side effect.
 *
 * WHY A LOAD-TIME SYNC IS NEEDED AT ALL
 * A browser can replace a push subscription on its own — keys rotate, the
 * profile is restored on a new machine, the push service migrates the user.
 * The new endpoint is only visible to the browser, and if the server never
 * hears about it the messages keep being pushed to an endpoint that no longer
 * exists. That failure is completely silent: `web-push` gets a 410, deletes the
 * row, and the user simply stops getting notifications with nothing to explain
 * why. Re-registering on every load closes that window to at most one visit.
 *
 * It is deliberately quiet: no prompt (permission is only ever requested from a
 * gesture — see the settings toggle), no toast, no retry loop. `syncSubscription`
 * swallows its own errors.
 */
"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/auth-client";
import { isEnabled, subscribeDesktopNotifications } from "@/lib/desktop-notifications";
import { pushSupported, syncSubscription } from "@/lib/push-client";

export function PushSubscriptionBridge() {
  const { user } = useSession();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    if (!pushSupported()) return;
    // Nothing to sync when the user has switched desktop notifications off —
    // and re-registering would contradict the choice they made.
    if (!isEnabled()) return;

    let cancelled = false;
    void (async () => {
      // Skip when permission was never granted: `syncSubscription` bails out
      // too, but checking here avoids registering the worker for a user who
      // has no intention of receiving anything.
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      if (cancelled) return;
      await syncSubscription();
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  /**
   * Re-sync when the user turns the toggle back on.
   *
   * The toggle lives in Settings and cannot reach this component, so the
   * preference store (which both read) is the channel. Without this, enabling
   * notifications in Settings would only take effect from the next page load.
   */
  useEffect(() => {
    if (!userId) return;
    return subscribeDesktopNotifications(() => {
      if (isEnabled() && pushSupported()) void syncSubscription();
    });
  }, [userId]);

  return null;
}
