/**
 * app/(app)/settings/page.tsx — settings hub.
 * Tabs: Profile, Privacy, Notifications, Security (password, sessions/devices,
 * login activity). All controls hit the real API.
 */
"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Avatar,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormField,
  Icon,
  Input,
  LoadingState,
  Skeleton,
  Switch,
  TabPanel,
  Tabs,
  Textarea,
  toast,
  type IconName,
} from "@/components/ui";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError, uploadFile } from "@/lib/api-client";
import { cn } from "@/components/ui/utils";
import { useSession } from "@/lib/auth-client";
import { timeAgo, fullDateTime } from "@/lib/format";
import type {
  AuthSessionInfo,
  LoginActivityItem,
  NotificationPrefs,
  Page,
  SessionUser,
} from "@/lib/api-types";
import { NotificationPrefRow } from "@/components/notifications/NotificationCenter";
import { ManagerSection } from "@/components/settings/ManagerSection";
import {
  ACCENT_IDS,
  ACCENT_SWATCH,
  DARK_SURFACE_IDS,
  DEFAULT_PALETTE,
  LIGHT_SURFACE_IDS,
  RADIUS_IDS,
  SURFACE_SWATCH,
  useTheme,
  type AccentId,
  type RadiusId,
  type ResolvedTheme,
  type SurfaceId,
  type Theme,
} from "@/lib/theme";
import { readableInkOn } from "@/lib/color";
import { describeDevice, type DeviceKind } from "@/lib/device";
import {
  MIN_PASSWORD_LENGTH,
  passwordFieldErrors,
  passwordStrength,
} from "@/lib/password-strength";
import {
  DEFAULT_SETTINGS_TAB,
  resolveSettingsTab,
  settingsTabQuery,
  type SettingsTab,
} from "@/lib/settings-tabs";

const PREF_META: { key: keyof NotificationPrefs; label: string; description: string }[] = [
  { key: "likes", label: "Likes", description: "Someone likes your post or comment" },
  { key: "comments", label: "Comments", description: "Someone comments on your post" },
  { key: "follows", label: "Follows", description: "Someone follows you" },
  { key: "mentions", label: "Mentions", description: "Someone mentions @you" },
  { key: "messages", label: "Messages", description: "New direct or group messages" },
  { key: "invitations", label: "Invitations", description: "Company or team invitations" },
  { key: "announcements", label: "Announcements", description: "Company announcements and role changes" },
  { key: "calls", label: "Calls", description: "Missed call notifications" },
  { key: "security", label: "Security", description: "Report decisions and security events" },
];

/** key → human label, for error messages that name the row that failed. */
const PREF_LABEL = Object.fromEntries(
  PREF_META.map((m) => [m.key, m.label]),
) as Record<keyof NotificationPrefs, string>;

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>(DEFAULT_SETTINGS_TAB);

  // Deep links (/settings?tab=security) arrive in the query string. Read it
  // after mount: the server pass has no `window`, and the active tab is not
  // part of the server-rendered output. Notification deep links depend on
  // this — a report-status notification used to open the Profile tab.
  useEffect(() => {
    const requested = resolveSettingsTab(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot URL read on mount
    if (requested !== DEFAULT_SETTINGS_TAB) setTab(requested);
  }, []);

  const changeTab = (id: string) => {
    setTab(id as SettingsTab);
    // Keep the URL shareable and refresh-safe, without stacking a history
    // entry for every tab click.
    const query = settingsTabQuery(id as SettingsTab);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <h1 className="text-h1 font-bold tracking-tight">Settings</h1>
      <Tabs
        value={tab}
        onValueChange={changeTab}
        label="Settings sections"
        tabs={[
          { id: "profile", label: "Profile" },
          { id: "appearance", label: "Appearance" },
          { id: "privacy", label: "Privacy" },
          { id: "notifications", label: "Notifications" },
          { id: "security", label: "Security" },
          { id: "manager", label: "Manager" },
        ]}
      >
        <TabPanel id="profile"><ProfileSection /></TabPanel>
        <TabPanel id="appearance"><AppearanceSection /></TabPanel>
        <TabPanel id="privacy"><PrivacySection /></TabPanel>
        <TabPanel id="notifications"><NotificationsSection /></TabPanel>
        <TabPanel id="security"><SecuritySection /></TabPanel>
        <TabPanel id="manager"><ManagerSection /></TabPanel>
      </Tabs>
    </div>
  );
}

/* ── Profile ──────────────────────────────────────────────────────────── */

function ProfileSection() {
  const { user, updateUser, refresh } = useSession();
  const [name, setName] = useState(user?.name ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [website, setWebsite] = useState(user?.website ?? "");
  const [location, setLocation] = useState(user?.location ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"avatar" | "cover" | null>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Seed the form from the session user when it first arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed form state from session
    setName(user?.name ?? "");
    setBio(user?.bio ?? "");
    setWebsite(user?.website ?? "");
    setLocation(user?.location ?? "");
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty =
    name !== (user?.name ?? "") ||
    bio !== (user?.bio ?? "") ||
    website !== (user?.website ?? "") ||
    location !== (user?.location ?? "");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const updated = await apiPatch<SessionUser>("/api/users/me", {
        name: name.trim(),
        bio: bio.trim() || null,
        website: website.trim() || null,
        location: location.trim() || null,
      });
      updateUser({
        name: updated.name,
        bio: updated.bio,
        website: updated.website,
        location: updated.location,
      });
      toast({ variant: "success", title: "Profile updated" });
    } catch (err) {
      toast({ variant: "error", title: err instanceof Error ? err.message : "Couldn't save changes" });
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = async (kind: "avatar" | "cover", file: File) => {
    setUploading(kind);
    try {
      const uploaded = await uploadFile(kind, file);
      const updated = await apiPatch<SessionUser>(
        "/api/users/me",
        kind === "avatar" ? { avatarUrl: uploaded.url } : { coverUrl: uploaded.url },
      );
      updateUser({ avatarUrl: updated.avatarUrl, coverUrl: updated.coverUrl });
      toast({ variant: "success", title: kind === "avatar" ? "Profile photo updated" : "Cover updated" });
    } catch (err) {
      toast({
        variant: "error",
        title: err instanceof ApiError ? err.message : "Upload failed. Please try again.",
      });
    } finally {
      setUploading(null);
      void refresh();
    }
  };

  const onFile = (kind: "avatar" | "cover") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ variant: "error", title: "Please choose an image file." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ variant: "error", title: "Image must be at most 5 MB." });
      return;
    }
    void uploadImage(kind, file);
  };

  return (
    <Card className="p-5">
      <form onSubmit={save} className="flex flex-col gap-5">
        {/* Cover */}
        <div>
          <p className="mb-2 text-body-sm font-medium text-ink">Cover photo</p>
          <button
            type="button"
            onClick={() => coverRef.current?.click()}
            className="relative block h-28 w-full overflow-hidden rounded-xl bg-brand-gradient-soft transition-opacity hover:opacity-90"
            aria-label={uploading === "cover" ? "Uploading cover…" : "Change cover photo"}
            disabled={uploading === "cover"}
          >
            {user?.coverUrl && (
              <img decoding="async" loading="lazy" src={user.coverUrl} alt="" aria-hidden className="img-dim h-full w-full object-cover" />
            )}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex items-center gap-2 rounded-full bg-overlay/60 px-4 py-2 text-body-sm font-medium text-on-overlay">
                <Icon name={uploading === "cover" ? "refresh" : "image"} size={16} aria-hidden />
                {uploading === "cover" ? "Uploading…" : "Change cover"}
              </span>
            </span>
          </button>
          <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Choose a cover photo" onChange={onFile("cover")} />
        </div>

        {/* Avatar */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => avatarRef.current?.click()}
            className="relative shrink-0 rounded-full transition-transform hover:scale-105"
            aria-label={uploading === "avatar" ? "Uploading photo…" : "Change profile photo"}
            disabled={uploading === "avatar"}
          >
            <Avatar src={user?.avatarUrl} name={user?.name ?? "?"} size="xl" />
            <span aria-hidden className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-surface bg-brand-cta text-on-brand">
              <Icon name="edit" size={14} />
            </span>
          </button>
          <div>
            <p className="text-body-sm font-medium text-ink">Profile photo</p>
            <p className="text-caption text-ink-3">JPG, PNG, or WebP · up to 5 MB</p>
          </div>
          <input ref={avatarRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Choose a profile photo" onChange={onFile("avatar")} />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Full name" required>
            {({ id, ...fp }) => (
              <Input id={id} {...fp} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
            )}
          </FormField>
          <FormField label="Username" hint="Usernames can't be changed yet.">
            {({ id }) => (
              <Input id={id} value={`@${user?.username ?? ""}`} disabled aria-describedby={undefined} />
            )}
          </FormField>
        </div>
        <FormField label="Bio" hint={`${bio.length} / 280`}>
          {({ id, ...fp }) => (
            <Textarea id={id} {...fp} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={280} rows={3} placeholder="Tell the world a little about yourself…" />
          )}
        </FormField>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Website">
            {({ id, ...fp }) => (
              <Input id={id} {...fp} value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={2048} placeholder="https://example.com" inputMode="url" />
            )}
          </FormField>
          <FormField label="Location">
            {({ id, ...fp }) => (
              <Input id={id} {...fp} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={60} placeholder="City, Country" />
            )}
          </FormField>
        </div>

        <div className="flex justify-end">
          <Button type="submit" loading={saving} disabled={!dirty}>
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ── Appearance ───────────────────────────────────────────────────────── */

const ACCENT_LABEL: Record<AccentId, string> = {
  avocado: "Avocado",
  emerald: "Emerald",
  ocean: "Ocean",
  violet: "Violet",
  rose: "Rose",
  amber: "Amber",
  graphite: "Graphite",
};

const SURFACE_LABEL: Record<SurfaceId, string> = {
  warm: "Warm paper",
  neutral: "Neutral grey",
  cool: "Cool mist",
  forest: "Forest",
  graphite: "Graphite",
  midnight: "Midnight",
};

const RADIUS_LABEL: Record<RadiusId, string> = {
  sharp: "Sharp",
  default: "Default",
  round: "Rounded",
};

const RADIUS_SAMPLE: Record<RadiusId, string> = {
  sharp: "rounded-[3px]",
  default: "rounded-md",
  round: "rounded-2xl",
};

function AppearanceSection() {
  const {
    theme,
    resolvedTheme,
    setTheme,
    palette,
    setModePalette,
    setRadius,
    resetPalette,
  } = useTheme();

  // The editor always targets the mode that is currently on screen, so what
  // you change is exactly what you see. Switch the theme above to edit the
  // other mode's palette — the two are stored independently.
  const mode: ResolvedTheme = resolvedTheme;
  const current = palette[mode];
  const surfaces = mode === "dark" ? DARK_SURFACE_IDS : LIGHT_SURFACE_IDS;

  const isDefault =
    current.accent === DEFAULT_PALETTE[mode].accent &&
    current.surface === DEFAULT_PALETTE[mode].surface &&
    palette.radius === DEFAULT_PALETTE.radius;

  return (
    <div className="flex flex-col gap-4">
      {/* Mode */}
      <Card className="p-5">
        <h2 className="text-h3 font-bold">Theme</h2>
        <p className="mt-1 text-body-sm text-ink-2">
          Light and dark keep separate palettes — switching modes never
          overwrites the other one&apos;s colours.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3" role="group" aria-label="Theme">
          {(["light", "dark", "system"] as const).map((t) => (
            <ThemePreviewCard key={t} value={t} active={theme === t} onSelect={setTheme} />
          ))}
        </div>
      </Card>

      {/* Palette */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-h3 font-bold">Colours</h2>
            <p className="mt-1 text-body-sm text-ink-2">
              Editing the <span className="font-semibold capitalize text-ink">{mode}</span> palette
              {theme === "system" && " (following your system)"}.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={resetPalette} disabled={isDefault}>
            <Icon name="refresh" size={15} aria-hidden className="mr-1.5" />
            Reset colours
          </Button>
        </div>

        <div className="mt-5 flex flex-col gap-6">
          {/* Accent */}
          <div>
            <p className="text-body-sm font-medium text-ink">Accent colour</p>
            <p className="text-caption text-ink-3">
              Buttons, links, badges and your own chat bubbles.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2.5" role="radiogroup" aria-label="Accent colour">
              {ACCENT_IDS.map((id) => (
                <SwatchButton
                  key={id}
                  color={ACCENT_SWATCH[id]}
                  label={ACCENT_LABEL[id]}
                  selected={current.accent === id}
                  onSelect={() => setModePalette(mode, { accent: id })}
                />
              ))}
            </div>
          </div>

          {/* Surface tone */}
          <div>
            <p className="text-body-sm font-medium text-ink">Surface tone</p>
            <p className="text-caption text-ink-3">
              The canvas, card, border and text colours.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Surface tone">
              {surfaces.map((id) => (
                <SurfaceSwatch
                  key={id}
                  surface={id}
                  label={SURFACE_LABEL[id]}
                  selected={current.surface === id}
                  onSelect={() => setModePalette(mode, { surface: id })}
                />
              ))}
            </div>
          </div>

          {/* Radius */}
          <div>
            <p className="text-body-sm font-medium text-ink">Corner roundness</p>
            <p className="text-caption text-ink-3">Applies to both modes.</p>
            <div className="mt-2.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Corner roundness">
              {RADIUS_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={palette.radius === id}
                  onClick={() => setRadius(id)}
                  className={cn(
                    "flex min-h-11 items-center gap-2.5 rounded-xl border px-3 py-1.5 text-body-sm font-medium transition-colors duration-fast",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                    palette.radius === id
                      ? "border-brand bg-brand-soft text-brand-strong"
                      : "border-line text-ink-2 hover:border-line-strong hover:text-ink",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("h-5 w-5 border-2 border-current", RADIUS_SAMPLE[id])}
                  />
                  {RADIUS_LABEL[id]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Live preview — real tokens, not a mock-up */}
      <Card className="p-5">
        <h2 className="text-h3 font-bold">Preview</h2>
        <p className="mt-1 text-body-sm text-ink-2">
          Updates the instant you change a colour.
        </p>
        <div className="mt-4 rounded-2xl border border-line bg-canvas p-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-cta text-on-brand shadow-pop"
            >
              <Icon name="message" size={17} />
            </span>
            <span aria-hidden className="flex flex-col gap-1.5">
              <span className="block h-2 w-28 rounded-full bg-ink-3/50" />
              <span className="block h-2 w-16 rounded-full bg-line" />
            </span>
          </div>

          <div className="mt-4 rounded-xl border border-line bg-surface p-3.5 shadow-sm">
            <p className="text-body-sm font-semibold text-ink">Card surface</p>
            <p className="mt-0.5 text-caption text-ink-3">Muted caption on the card surface.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-brand-cta px-3.5 py-1.5 text-caption font-semibold text-on-brand">
                Primary
              </span>
              <span className="rounded-full border border-line px-3.5 py-1.5 text-caption font-medium text-ink-2">
                Secondary
              </span>
              <span className="rounded-full bg-brand-soft px-3.5 py-1.5 text-caption font-semibold text-brand-strong">
                Accent chip
              </span>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <span className="max-w-[80%] self-start rounded-2xl border border-line/60 bg-bubble-their px-3.5 py-2 text-body-sm text-ink shadow-sm">
              Their message
            </span>
            <span className="max-w-[80%] self-end rounded-2xl bg-bubble-own px-3.5 py-2 text-body-sm text-ink shadow-sm">
              Your message
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function SwatchButton({
  color,
  label,
  selected,
  onSelect,
}: {
  color: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  // The tick must stay visible on every swatch, including pale ones.
  const ink = readableInkOn(color);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      style={{ backgroundColor: color }}
      className={cn(
        "flex h-11 w-11 items-center justify-center rounded-full border-2 transition-transform duration-fast hover:scale-105",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        selected ? "border-ink" : "border-line",
      )}
    >
      {selected && (
        <span aria-hidden style={{ color: ink }}>
          <Icon name="check" size={16} />
        </span>
      )}
    </button>
  );
}

function SurfaceSwatch({
  surface,
  label,
  selected,
  onSelect,
}: {
  surface: SurfaceId;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const [base, raised] = SURFACE_SWATCH[surface];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      className={cn(
        "flex min-h-11 items-center gap-2.5 rounded-xl border px-3 py-1.5 text-body-sm font-medium transition-colors duration-fast",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        selected
          ? "border-brand bg-brand-soft text-brand-strong"
          : "border-line text-ink-2 hover:border-line-strong hover:text-ink",
      )}
    >
      <span aria-hidden className="flex h-5 w-5 overflow-hidden rounded-md border border-line-strong">
        <span className="h-full w-1/2" style={{ backgroundColor: base }} />
        <span className="h-full w-1/2" style={{ backgroundColor: raised }} />
      </span>
      {label}
    </button>
  );
}

function ThemePreviewCard({
  value,
  active,
  onSelect,
}: {
  value: Theme;
  active: boolean;
  onSelect: (t: Theme) => void;
}) {
  const { palette } = useTheme();
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={active}
      aria-label={`${value} theme${active ? " (selected)" : ""}`}
      className={cn(
        "group flex flex-col gap-2 rounded-2xl border-2 p-2 text-left transition-all duration-200",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        active
          ? "border-brand shadow-pop"
          : "border-line hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md",
      )}
    >
      <span aria-hidden className="flex h-20 gap-0.5 overflow-hidden rounded-xl">
        {value === "system" ? (
          <>
            <MiniMock
              accent={ACCENT_SWATCH[palette.light.accent]}
              className="flex-1 rounded-l-[10px] rounded-r-none"
            />
            <MiniMock
              dark
              accent={ACCENT_SWATCH[palette.dark.accent]}
              className="flex-1 rounded-l-none rounded-r-[10px]"
            />
          </>
        ) : (
          <MiniMock
            dark={value === "dark"}
            accent={ACCENT_SWATCH[palette[value].accent]}
            className="flex-1"
          />
        )}
      </span>
      <span className="flex items-center justify-between px-1 pb-0.5">
        <span className="text-body-sm font-semibold capitalize text-ink">{value}</span>
        <span
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-full transition-all",
            active
              ? "bg-brand-cta text-on-brand"
              : "bg-surface-2 text-transparent group-hover:text-ink-3",
          )}
        >
          <Icon name="check" size={12} />
        </span>
      </span>
    </button>
  );
}

/**
 * Miniature of one theme, drawn with literal colours on purpose: it has to show
 * what the OTHER mode looks like even while the app is in this one. The accent
 * dot uses the palette chosen for the mode being previewed.
 */
function MiniMock({
  dark = false,
  accent,
  className,
}: {
  dark?: boolean;
  accent: string;
  className?: string;
}) {
  return (
    <span
      className={cn("flex flex-col gap-1.5 p-2", dark ? "bg-[#131711]" : "bg-white", className)}
    >
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} />
        <span className={cn("h-1.5 w-8 rounded-full", dark ? "bg-white/25" : "bg-neutral-200")} />
      </span>
      <span className={cn("h-1.5 w-11/12 rounded-full", dark ? "bg-white/15" : "bg-neutral-100")} />
      <span className={cn("h-1.5 w-3/4 rounded-full", dark ? "bg-white/15" : "bg-neutral-100")} />
      <span className="mt-auto flex items-center gap-1.5">
        <span className={cn("h-3.5 w-3.5 rounded-full", dark ? "bg-white/25" : "bg-neutral-200")} />
        <span
          className="h-1.5 flex-1 rounded-full"
          style={{ backgroundColor: accent, opacity: dark ? 0.55 : 0.4 }}
        />
      </span>
    </span>
  );
}

/* ── Privacy ──────────────────────────────────────────────────────────── */

function PrivacySection() {
  const { user, updateUser } = useSession();
  const [saving, setSaving] = useState(false);

  const togglePrivate = async (checked: boolean) => {
    setSaving(true);
    try {
      const updated = await apiPatch<SessionUser>("/api/users/me", { isPrivate: checked });
      updateUser({ isPrivate: updated.isPrivate });
      toast({
        variant: "success",
        title: checked ? "Your account is now private" : "Your account is now public",
        description: checked ? "Only approved followers will see your posts." : undefined,
      });
    } catch (err) {
      toast({ variant: "error", title: err instanceof Error ? err.message : "Couldn't update privacy" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="divide-y divide-line p-5">
        <div className="flex items-center justify-between gap-4 pb-4">
          <div>
            <p className="text-body-sm font-medium text-ink">Private account</p>
            <p className="text-caption text-ink-3">
              When private, only people you approve can see your posts. Your profile stays visible.
            </p>
          </div>
          <Switch label="Private account" checked={user?.isPrivate ?? false} onCheckedChange={(c) => void togglePrivate(c)} disabled={saving} />
        </div>
        <div className="pt-4">
          <p className="text-body-sm font-medium text-ink">Blocked & muted accounts</p>
          <p className="mt-1 text-body-sm text-ink-2">
            Mute or block someone from their profile. Muted accounts&apos; posts disappear from your
            feeds; blocked accounts can&apos;t see you or contact you. You can unmute or unblock
            anytime from their profile page.
          </p>
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="text-h3 font-bold">Your data</h2>
        <p className="mt-1 text-body-sm text-ink-2">
          Signed in as <span className="font-semibold text-ink">{user?.email}</span>
          {user?.emailVerified ? (
            <span className="ml-2 inline-flex items-center gap-1 text-success-strong">
              <Icon name="check" size={14} aria-hidden /> Verified
            </span>
          ) : (
            <span className="ml-2 text-warning-strong">Not verified</span>
          )}
        </p>
        <p className="mt-2 text-caption text-ink-3">
          Account created {user?.createdAt ? fullDateTime(user.createdAt) : "—"}
        </p>
      </Card>
    </div>
  );
}

/* ── Notifications ────────────────────────────────────────────────────── */

function NotificationsSection() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<NotificationPrefs>("/api/users/me/notification-preferences")
      .then((p) => {
        if (!cancelled) setPrefs(p);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load preferences.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (key: keyof NotificationPrefs, checked: boolean) => {
    if (!prefs) return;
    setSavingKey(key);
    setSaveError(null);
    const prev = prefs;
    setPrefs({ ...prefs, [key]: checked });
    try {
      await apiPatch<NotificationPrefs>("/api/users/me/notification-preferences", { [key]: checked });
    } catch (err) {
      setPrefs(prev);
      const message = err instanceof Error ? err.message : "Couldn't save preference";
      // Surface it next to the rows too: with nine toggles a toast alone
      // doesn't tell the user which one bounced.
      setSaveError(`Couldn't save “${PREF_LABEL[key]}”. ${message}`);
      toast({ variant: "error", title: message });
    } finally {
      setSavingKey(null);
    }
  };

  /** Pause/resume every category in one request. */
  const setAll = async (enabled: boolean) => {
    if (!prefs) return;
    setBulkSaving(true);
    setSaveError(null);
    const prev = prefs;
    const next = Object.fromEntries(
      Object.keys(prefs).map((k) => [k, enabled]),
    ) as NotificationPrefs;
    setPrefs(next);
    try {
      await apiPatch<NotificationPrefs>("/api/users/me/notification-preferences", next);
      toast({
        variant: "success",
        title: enabled ? "All notifications resumed" : "All notifications paused",
      });
    } catch (err) {
      setPrefs(prev);
      toast({
        variant: "error",
        title: err instanceof Error ? err.message : "Couldn't update your preferences",
      });
    } finally {
      setBulkSaving(false);
    }
  };

  if (error) {
    return <ErrorState title="Couldn't load notification settings" message={error} retryLabel="Try again" onRetry={() => window.location.reload()} />;
  }
  if (!prefs) {
    return (
      <Card className="p-5" aria-label="Loading notification settings">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between py-3">
            <Skeleton className="h-4 w-40 rounded" />
            <Skeleton className="h-7 w-12 rounded-full" />
          </div>
        ))}
      </Card>
    );
  }

  const allPaused = PREF_META.every((m) => !prefs[m.key]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-body-sm font-medium text-ink">Pause all notifications</p>
            <p className="text-caption text-ink-3">
              Silences every category below in one go. Turn it back off to restore
              your previous choices.
            </p>
          </div>
          <Switch
            label="Pause all notifications"
            checked={allPaused}
            disabled={bulkSaving || savingKey !== null}
            onCheckedChange={(c) => void setAll(!c)}
          />
        </div>
      </Card>

      <Card className="divide-y divide-line px-5">
        {PREF_META.map((m) => (
          <NotificationPrefRow
            key={m.key}
            label={m.label}
            description={m.description}
            checked={prefs[m.key]}
            disabled={savingKey === m.key || bulkSaving}
            onChange={(c) => void toggle(m.key, c)}
          />
        ))}
        {saveError && (
          <p role="alert" className="py-3 text-caption font-medium text-danger">
            {saveError}
          </p>
        )}
        <p className="py-4 text-caption text-ink-3">
          Only platform messages from the AvoMessage team are always delivered.
          Everything listed above — including Security, which covers decisions on
          reports you file — can be switched off.
        </p>
      </Card>
    </div>
  );
}

/* ── Security ─────────────────────────────────────────────────────────── */

function SecuritySection() {
  const [sessions, setSessions] = useState<AuthSessionInfo[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Loaded once here and shared with the overview and the device list, so the
  // two cards can never disagree and a single refresh updates both.
  const loadSessions = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await apiGet<{ data: AuthSessionInfo[] }>("/api/auth/sessions");
      setSessions(res.data);
      setSessionsError(null);
    } catch (e) {
      setSessionsError(e instanceof Error ? e.message : "Couldn't load sessions.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial sessions fetch
    void loadSessions();
  }, [loadSessions]);

  return (
    <div className="flex flex-col gap-4">
      <SecurityOverviewCard
        sessions={sessions}
        refreshing={refreshing}
        onRefresh={() => void loadSessions()}
      />
      <PasswordCard />
      <SessionsCard
        sessions={sessions}
        error={sessionsError}
        refreshing={refreshing}
        onReload={loadSessions}
      />
      <LoginActivityCard />
      <SignOutCard />
    </div>
  );
}

/**
 * Force a re-render on an interval so relative timestamps ("Active 3 minutes
 * ago") don't freeze at whatever they read when the row was fetched.
 */
function useRelativeTimeTick(intervalMs = 30_000): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

/**
 * At-a-glance security posture. Everything here is real state — no invented
 * "last password change" that nothing records.
 */
function SecurityOverviewCard({
  sessions,
  refreshing,
  onRefresh,
}: {
  sessions: AuthSessionInfo[] | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { user } = useSession();
  useRelativeTimeTick();
  const activeCount = sessions?.length ?? null;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-h3 font-bold">Account security</h2>
          <p className="mt-1 text-body-sm text-ink-2">How your account is protected right now.</p>
        </div>
        <Button variant="outline" size="sm" loading={refreshing} onClick={onRefresh}>
          <Icon name="refresh" size={15} aria-hidden className="mr-1.5" />
          Refresh
        </Button>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <SecurityStat
          icon="lock"
          label="Sign-in"
          value="Password"
          hint="Two-factor authentication isn't available yet."
          tone="neutral"
        />
        <SecurityStat
          icon={user?.emailVerified ? "check" : "alert"}
          label="Email"
          value={user?.emailVerified ? "Verified" : "Not verified"}
          hint={user?.email ?? "—"}
          tone={user?.emailVerified ? "ok" : "warn"}
        />
        <SecurityStat
          icon="monitor"
          label="Active sessions"
          value={activeCount === null ? "…" : String(activeCount)}
          hint={
            activeCount === null
              ? "Checking…"
              : activeCount === 1
                ? "Only this device is signed in."
                : "Sign out any you don't recognise."
          }
          tone={activeCount !== null && activeCount > 1 ? "warn" : "ok"}
        />
      </dl>
    </Card>
  );
}

function SecurityStat({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: IconName;
  label: string;
  value: string;
  hint: string;
  tone: "ok" | "warn" | "neutral";
}) {
  const chip =
    tone === "warn"
      ? "bg-warning/15 text-warning-strong"
      : tone === "ok"
        ? "bg-success/15 text-success-strong"
        : "bg-surface-2 text-ink-2";
  return (
    <div className="rounded-xl border border-line bg-surface-2/50 p-3.5">
      <div className="flex items-center gap-2">
        <span aria-hidden className={cn("flex h-7 w-7 items-center justify-center rounded-full", chip)}>
          <Icon name={icon} size={15} />
        </span>
        <dt className="text-caption font-semibold uppercase tracking-wide text-ink-3">{label}</dt>
      </div>
      <dd className="mt-2 text-body-sm font-semibold text-ink">{value}</dd>
      <dd className="mt-0.5 text-caption text-ink-3">{hint}</dd>
    </div>
  );
}

function SignOutCard() {
  const { logout } = useSession();
  const [confirming, setConfirming] = useState(false);
  return (
    <Card className="p-5">
      <h2 className="text-h3 font-bold">Sign out</h2>
      <p className="mt-1 text-body-sm text-ink-2">
        Sign out of AvoMessage on this device.
      </p>
      <div className="mt-4">
        <Button variant="outline" onClick={() => setConfirming(true)}>
          <Icon name="logout" size={16} aria-hidden /> Log out
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Log out?"
        description="You'll be signed out of AvoMessage on this device."
        confirmLabel="Log out"
        tone="danger"
        icon="logout"
        onConfirm={() => void logout()}
      />
    </Card>
  );
}

/** Tailwind fill for each of the four strength segments (1–4). */
const STRENGTH_BAR: Record<number, string> = {
  1: "bg-danger",
  2: "bg-warning",
  3: "bg-info",
  4: "bg-success",
};

type PasswordField = "current" | "next" | "confirm";

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState<Record<PasswordField, boolean>>({
    current: false,
    next: false,
    confirm: false,
  });
  // Set on the first submit attempt so errors appear even if the user never
  // blurred a field — otherwise the form looked valid right up until the click.
  const [attempted, setAttempted] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const currentRef = useRef<HTMLInputElement>(null);

  const showNext = touched.next || attempted;
  const showConfirm = touched.confirm || attempted;

  // Hard rules mirror `changePasswordSchema` on the server: current required,
  // new password ≥ MIN_PASSWORD_LENGTH, confirm must match. Nothing stricter,
  // so a password the API would accept is never blocked here.
  const fieldErrors = passwordFieldErrors(next, confirm);
  const nextError = showNext ? fieldErrors.next : null;
  const confirmError = showConfirm ? fieldErrors.confirm : null;

  const strength = passwordStrength(next);
  const hasInput = current.length > 0 || next.length > 0 || confirm.length > 0;
  const valid =
    current.length > 0 && next.length >= MIN_PASSWORD_LENGTH && confirm === next;

  const blur = (field: PasswordField) => () => setTouched((t) => ({ ...t, [field]: true }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    setCurrentError(null);
    if (!valid) {
      // Send focus to the first field that is wrong.
      if (current.length === 0) currentRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const res = await apiPost<{ ok: boolean; revokedOtherSessions: number }>("/api/users/me/password", {
        currentPassword: current,
        newPassword: next,
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      setTouched({ current: false, next: false, confirm: false });
      setAttempted(false);
      // Never leave the new password rendered in plain text.
      setShow(false);
      toast({
        variant: "success",
        title: "Password changed",
        description:
          res.revokedOtherSessions > 0
            ? `Signed out ${res.revokedOtherSessions} other session${res.revokedOtherSessions === 1 ? "" : "s"}.`
            : undefined,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "INVALID_CREDENTIALS") {
        // Inline, on the field — a toast alone left the user guessing which
        // input was rejected.
        setCurrentError("That doesn't match your current password.");
        setTouched((t) => ({ ...t, current: true }));
        currentRef.current?.focus();
      } else {
        toast({
          variant: "error",
          title: err instanceof Error ? err.message : "Couldn't change password",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="text-h3 font-bold">Change password</h2>
      <p className="mt-1 text-body-sm text-ink-2">
        Changing your password signs out every other device.
      </p>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-4" noValidate>
        <FormField label="Current password" required error={currentError ?? undefined}>
          {({ id, ...fp }) => (
            <div className="relative">
              <Input
                id={id}
                {...fp}
                ref={currentRef}
                type={show ? "text" : "password"}
                autoComplete="current-password"
                value={current}
                onChange={(e) => {
                  setCurrent(e.target.value);
                  if (currentError) setCurrentError(null);
                }}
                onBlur={blur("current")}
                className="pr-12"
              />
              <ShowPasswordToggle show={show} onToggle={() => setShow((s) => !s)} />
            </div>
          )}
        </FormField>

        <FormField
          label="New password"
          required
          error={nextError ?? undefined}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        >
          {({ id, ...fp }) => (
            <Input
              id={id}
              {...fp}
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              onBlur={blur("next")}
            />
          )}
        </FormField>

        {next.length > 0 && (
          <div aria-live="polite">
            <div className="flex items-center gap-2">
              <div className="flex h-1.5 flex-1 gap-1" role="presentation">
                {[1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-full flex-1 rounded-full transition-colors duration-fast",
                      i <= strength.score ? STRENGTH_BAR[strength.score] : "bg-line",
                    )}
                  />
                ))}
              </div>
              <span className="w-14 text-right text-caption font-medium text-ink-2">
                {strength.label}
              </span>
            </div>
            <p className="mt-1 text-caption text-ink-3">
              Longer is better. Mixing upper and lower case, numbers and symbols
              makes it stronger.
            </p>
          </div>
        )}

        <FormField label="Confirm new password" required error={confirmError ?? undefined}>
          {({ id, ...fp }) => (
            <Input
              id={id}
              {...fp}
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onBlur={blur("confirm")}
            />
          )}
        </FormField>

        <div className="flex justify-end">
          {/* Enabled while anything is typed so the errors can actually be
              shown; `disabled` only when there is nothing to submit. */}
          <Button type="submit" loading={saving} disabled={!hasInput}>
            Update password
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Shared show/hide control — used on every password field so the eye means the same thing on all three. */
function ShowPasswordToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={show ? "Hide password" : "Show password"}
      className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink"
    >
      <Icon name={show ? "eyeOff" : "eye"} size={18} />
    </button>
  );
}

/**
 * Sessions are loaded by SecuritySection and passed in, so this card, the
 * overview card and the refresh button all read one source of truth.
 */
function SessionsCard({
  sessions,
  error,
  refreshing,
  onReload,
}: {
  sessions: AuthSessionInfo[] | null;
  error: string | null;
  refreshing: boolean;
  onReload: () => Promise<void>;
}) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);

  // Keeps "Active 3 minutes ago" honest while the card is open; without it the
  // label froze at whatever it read when the list was fetched.
  useRelativeTimeTick();

  const revokeOne = async (id: string) => {
    setRevoking(id);
    try {
      await apiDelete(`/api/auth/sessions/${id}`);
      await onReload();
      toast({ variant: "success", title: "Session revoked" });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Couldn't revoke session" });
    } finally {
      setRevoking(null);
    }
  };

  const revokeOthers = async () => {
    setConfirmRevokeAll(false);
    setRevoking("all");
    try {
      const res = await apiDelete<{ ok: boolean; revoked: number }>("/api/auth/sessions");
      await onReload();
      toast({ variant: "success", title: `Signed out ${res.revoked} other session${res.revoked === 1 ? "" : "s"}` });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Couldn't sign out other sessions" });
    } finally {
      setRevoking(null);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-h3 font-bold">Sessions &amp; devices</h2>
          <p className="mt-1 text-body-sm text-ink-2">
            {sessions === null
              ? "Checking where you're signed in…"
              : `Signed in on ${sessions.length} device${sessions.length === 1 ? "" : "s"}.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" loading={refreshing} onClick={() => void onReload()}>
            <Icon name="refresh" size={15} aria-hidden className="mr-1.5" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            loading={revoking === "all"}
            onClick={() => setConfirmRevokeAll(true)}
            disabled={!sessions || sessions.length <= 1}
          >
            Sign out other devices
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-col divide-y divide-line">
        {error && sessions === null ? (
          <ErrorState title="Couldn't load sessions" message={error} retryLabel="Try again" onRetry={() => void onReload()} compact />
        ) : sessions === null ? (
          <LoadingState message="Loading sessions…" compact />
        ) : sessions.length === 0 ? (
          <EmptyState icon="shield" title="No active sessions" compact />
        ) : (
          sessions.map((s) => {
            const device = describeDevice(s.userAgent);
            return (
              <div key={s.id} className="flex items-center gap-3 py-3">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2">
                  <Icon name={DEVICE_ICON[device.kind]} size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-sm font-medium text-ink">
                    {device.label}
                    {s.current && (
                      <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-tiny font-semibold text-brand-strong">
                        This device
                      </span>
                    )}
                  </p>
                  <p className="truncate text-caption text-ink-3" title={fullDateTime(s.lastActiveAt)}>
                    {s.ipAddress ? `${s.ipAddress} · ` : ""}Active {timeAgo(s.lastActiveAt)}
                  </p>
                  <p className="truncate text-caption text-ink-3" title={fullDateTime(s.createdAt)}>
                    Signed in {timeAgo(s.createdAt)}
                  </p>
                </div>
                {!s.current && (
                  <Button variant="ghost" size="sm" loading={revoking === s.id} onClick={() => void revokeOne(s.id)}>
                    Revoke
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
      <ConfirmDialog
        open={confirmRevokeAll}
        onOpenChange={setConfirmRevokeAll}
        title="Sign out other devices?"
        description="Every other session will be signed out immediately. You'll stay signed in here."
        confirmLabel="Sign out others"
        tone="danger"
        icon="logout"
        onConfirm={() => void revokeOthers()}
      />
    </Card>
  );
}

/**
 * Glyph per device kind. Every desktop session used to be drawn with the
 * generic "info" icon, so all devices looked alike.
 * `describeDevice` (the classification itself) lives in lib/device.ts.
 */
const DEVICE_ICON: Record<DeviceKind, IconName> = {
  desktop: "monitor",
  tablet: "tablet",
  phone: "phone",
};

function LoginActivityCard() {
  const [items, setItems] = useState<LoginActivityItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const res = await apiGet<Page<LoginActivityItem>>("/api/auth/login-activity", { params: { cursor, limit: 10 } });
      setItems((prev) => [...(prev ?? []), ...res.data]);
      setCursor(res.nextCursor);
      setHasMore(res.nextCursor !== null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load login activity.");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial login-activity fetch
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="p-5">
      <h2 className="text-h3 font-bold">Recent login activity</h2>
      <div className="mt-3 flex flex-col divide-y divide-line">
        {error && !items ? (
          <ErrorState title="Couldn't load login activity" message={error} retryLabel="Try again" onRetry={() => void loadMore()} compact />
        ) : !items ? (
          <LoadingState message="Loading activity…" compact />
        ) : items.length === 0 ? (
          <EmptyState icon="shield" title="No login activity yet" compact />
        ) : (
          items.map((a) => (
            <div key={a.id} className="flex items-center gap-3 py-2.5">
              <span
                aria-hidden
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${a.success ? "bg-success/10 text-success-strong" : "bg-danger/10 text-danger"}`}
              >
                <Icon name={a.success ? "check" : "x"} size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body-sm text-ink">
                  {a.success ? "Successful sign-in" : "Failed sign-in attempt"}
                  {a.reason && !a.success && <span className="text-ink-3"> · {a.reason}</span>}
                </p>
                <p className="truncate text-caption text-ink-3" title={a.userAgent ?? undefined}>
                  {[a.ipAddress, describeDevice(a.userAgent).label].filter(Boolean).join(" · ")} · {timeAgo(a.createdAt)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* A failed *later* page used to render nothing at all: the error state
          above only fires when `items` is still null, and `loadMore` keeps
          re-trying on every click with no feedback. */}
      {error && items && (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3"
        >
          <p className="text-body-sm text-ink">Couldn&apos;t load more activity. {error}</p>
          <Button variant="outline" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
            Try again
          </Button>
        </div>
      )}

      {hasMore && items && items.length > 0 && !error && (
        <div className="mt-3 flex justify-center">
          <Button variant="ghost" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
            Show more
          </Button>
        </div>
      )}

      {!hasMore && items && items.length > 0 && (
        <p className="mt-3 text-center text-caption text-ink-3">
          That&apos;s your full sign-in history.
        </p>
      )}
    </Card>
  );
}
