/**
 * User-Agent classification for the sessions/devices screen.
 *
 * Lives here rather than inline in `app/(app)/settings/page.tsx` so it can be
 * unit-tested: it is pure string work with several order-dependent branches,
 * and a wrong branch shows the user the wrong device glyph.
 */

export type DeviceKind = "desktop" | "tablet" | "phone";

export interface DeviceDescription {
  /** e.g. "Chrome on Windows". */
  label: string;
  kind: DeviceKind;
}

/**
 * Classify a User-Agent.
 *
 * Order matters: an Android tablet also reports "Android", and an iPad on
 * iPadOS 13+ reports a desktop "Macintosh" UA — so the tablet and phone checks
 * must both run before the desktop fallback.
 */
export function describeDevice(ua: string | null): DeviceDescription {
  if (!ua) return { label: "Unknown device", kind: "desktop" };
  const lower = ua.toLowerCase();

  const isTablet =
    lower.includes("ipad") || (lower.includes("android") && !lower.includes("mobile"));
  const isPhone =
    lower.includes("iphone") ||
    lower.includes("ipod") ||
    lower.includes("windows phone") ||
    (lower.includes("android") && lower.includes("mobile"));

  // iOS first: every iPhone/iPad/iPod UA contains "like Mac OS X", so a
  // `mac os` check placed above this one would label them all as macOS.
  let os = "Unknown OS";
  if (lower.includes("iphone") || lower.includes("ipad") || lower.includes("ipod")) os = "iOS";
  else if (lower.includes("windows")) os = "Windows";
  else if (lower.includes("mac os")) os = "macOS";
  else if (lower.includes("cros")) os = "ChromeOS";
  else if (lower.includes("android")) os = "Android";
  else if (lower.includes("linux")) os = "Linux";

  let browser = "";
  if (lower.includes("edg/")) browser = "Edge";
  else if (lower.includes("opr/") || lower.includes("opera")) browser = "Opera";
  else if (lower.includes("chrome/")) browser = "Chrome";
  else if (lower.includes("safari/") && lower.includes("version/")) browser = "Safari";
  else if (lower.includes("firefox/")) browser = "Firefox";

  const kind: DeviceKind = isTablet ? "tablet" : isPhone ? "phone" : "desktop";
  return { label: browser ? `${browser} on ${os}` : os, kind };
}
