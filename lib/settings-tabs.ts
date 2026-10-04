/**
 * Settings tab identifiers + `?tab=` resolution.
 *
 * Extracted from the settings page so the deep-link contract is unit-tested.
 * Notification deep links depend on it: a report-status notification points at
 * `/settings?tab=security`, and before this existed the page always opened on
 * Profile no matter what the URL said.
 */

export const SETTINGS_TAB_IDS = [
  "profile",
  "appearance",
  "privacy",
  "notifications",
  "security",
  "manager",
] as const;

export type SettingsTab = (typeof SETTINGS_TAB_IDS)[number];

export const DEFAULT_SETTINGS_TAB: SettingsTab = "profile";

export function isSettingsTab(value: string | null | undefined): value is SettingsTab {
  return (
    typeof value === "string" && (SETTINGS_TAB_IDS as readonly string[]).includes(value)
  );
}

/**
 * The tab named by a query string (`"?tab=security"` or `"tab=security"`).
 * Unknown or missing values fall back to the default rather than throwing, so
 * a stale bookmark can never break the page.
 */
export function resolveSettingsTab(search: string): SettingsTab {
  const query = search.startsWith("?") ? search : `?${search}`;
  const raw = new URLSearchParams(query).get("tab");
  return isSettingsTab(raw) ? raw : DEFAULT_SETTINGS_TAB;
}

/** The query string for a tab, without the leading "?" — "" for the default. */
export function settingsTabQuery(tab: SettingsTab): string {
  return tab === DEFAULT_SETTINGS_TAB ? "" : `tab=${tab}`;
}
