/**
 * components/notifications/DesktopNotificationSetting.tsx — the Settings →
 * Notifications card that controls real OS notifications.
 *
 * Self-contained on purpose: `app/(app)/settings/page.tsx` is already the
 * largest client file in the app, and this card owns its own state, its own
 * permission dance and its own copy.
 *
 * THE PERMISSION DANCE
 * `Notification.requestPermission()` needs a user gesture, so the switch does
 * both jobs in one click: turn the preference on AND ask the browser. If the
 * browser says no, the switch snaps back and the card explains what to do —
 * leaving it visually "on" while nothing could ever be delivered would be a
 * lie the user only discovers when a message goes unnoticed.
 *
 * A "denied" permission cannot be re-requested from JavaScript at all; the
 * only way back is the browser's own site settings, so that is what the copy
 * says instead of offering a button that cannot work.
 */
"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Button, Card, Icon, Switch, toast } from "@/components/ui";
import {
  getDesktopNotificationsSnapshot,
  getServerDesktopNotificationsSnapshot,
  permissionState,
  requestPermission,
  setEnabled,
  show,
  subscribeDesktopNotifications,
  type DesktopPermission,
} from "@/lib/desktop-notifications";

export function DesktopNotificationSetting() {
  // `useSyncExternalStore` rather than `useState`: the bridge that actually
  // fires the notifications reads the same module store, so the switch and the
  // behaviour can never disagree. The server snapshot is "off", which is what
  // the markup renders with; the real value arrives in the re-render after
  // hydration.
  const enabled = useSyncExternalStore(
    subscribeDesktopNotifications,
    getDesktopNotificationsSnapshot,
    getServerDesktopNotificationsSnapshot,
  ) === "on";

  // Permission is browser state, not ours, so it is read on mount and after
  // every request. `null` = not read yet, which keeps the first paint stable.
  const [permission, setPermission] = useState<DesktopPermission | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    setPermission(permissionState());
  }, []);

  const supported = permission === "granted" || permission === "default" || permission === null;
  const granted = permission === "granted";
  const denied = permission === "denied";

  if (!supported) return null;

  const toggle = useCallback(
    async (next: boolean) => {
      if (!next) {
        setEnabled(false);
        return;
      }
      setAsking(true);
      try {
        const result = await requestPermission();
        setPermission(result);
        if (result === "granted") {
          setEnabled(true);
          toast({
            variant: "success",
            title: "Desktop notifications on",
            description: "You'll be notified when AvoMessage is in the background.",
          });
        } else if (result === "denied") {
          setEnabled(false);
          toast({
            variant: "warning",
            title: "Your browser blocked notifications",
            description: "Allow them for this site, then turn the switch on again.",
          });
        } else if (result === "unsupported") {
          setEnabled(false);
        }
      } finally {
        setAsking(false);
      }
    },
    [],
  );

  const sendTest = useCallback(() => {
    const shown = show(
      {
        title: "AvoMessage",
        body: "Desktop notifications are working. This is what a new message looks like.",
        tag: "avo-test",
      },
      // The whole point of the button is to be pressable while the tab is in
      // front of the user, so it deliberately skips the background-only rule.
      { force: true },
    );
    if (!shown) {
      toast({
        variant: "warning",
        title: "Couldn't show a notification",
        description: "Check that notifications are allowed for this site.",
      });
    }
  }, []);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-body-sm font-medium text-ink">
            <Icon name="bell" size={16} aria-hidden className="text-ink-3" />
            Desktop notifications
          </p>
          <p className="mt-0.5 text-caption text-ink-3">
            {denied
              ? "Your browser is blocking notifications for this site. Open the padlock (or the site controls) in the address bar, set Notifications to Allow, then reload this page."
              : "Shows a Windows notification when a message or alert arrives while AvoMessage is in the background. Nothing pops up while you are looking at the tab."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {granted && enabled && (
            <Button variant="outline" size="sm" onClick={sendTest}>
              Send a test
            </Button>
          )}
          <Switch
            label="Desktop notifications"
            checked={granted && enabled}
            disabled={asking || denied}
            onCheckedChange={(next) => void toggle(next)}
          />
        </div>
      </div>
    </Card>
  );
}

/**
 * The same control, in the form the notification centre needs: a one-line
 * prompt that only exists while the browser has never been asked.
 *
 * Without this the feature is only reachable by someone who goes looking in
 * Settings, and a permission nobody knows about is a permission nobody grants.
 * Once the answer is anything other than "default" the prompt removes itself —
 * granted means it has done its job, denied means repeating it would only
 * nag about something the page cannot fix.
 */
export function DesktopNotificationPrompt() {
  const [permission, setPermission] = useState<DesktopPermission | null>(null);
  const [asking, setAsking] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setPermission(permissionState());
  }, []);

  const turnOn = useCallback(async () => {
    setAsking(true);
    try {
      const result = await requestPermission();
      setPermission(result);
      if (result === "granted") {
        setEnabled(true);
        toast({
          variant: "success",
          title: "Desktop notifications on",
          description: "You'll be notified when AvoMessage is in the background.",
        });
      }
    } finally {
      setAsking(false);
    }
  }, []);

  if (permission !== "default" || dismissed) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand/30 bg-brand-soft/40 px-4 py-3">
      <Icon name="bell" size={18} aria-hidden className="shrink-0 text-brand-strong" />
      <p className="min-w-0 flex-1 text-body-sm text-ink">
        <span className="font-semibold">Turn on desktop notifications</span>{" "}
        <span className="text-ink-2">
          so a new message reaches you even when this tab is in the background.
        </span>
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" loading={asking} onClick={() => void turnOn()}>
          Turn on
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
          Not now
        </Button>
      </div>
    </div>
  );
}
