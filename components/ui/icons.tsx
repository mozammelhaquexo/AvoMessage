import type { SVGProps } from "react";
import { cn } from "./utils";

/**
 * AvoMessage icon set — expressive inline SVGs, no emoji.
 * Consistent 24×24 grid, 2px stroke, round caps/joins, `currentColor`.
 *
 * Usage: <Icon name="home" size={20} className="text-ink-2" />
 */

export type IconName =
  | "home"
  | "globe"
  | "message"
  | "bell"
  | "user"
  | "users"
  | "building"
  | "search"
  | "settings"
  | "help"
  | "logout"
  | "plus"
  | "heart"
  | "comment"
  | "share"
  | "bookmark"
  | "image"
  | "mic"
  | "micOff"
  | "phone"
  | "phoneOff"
  | "phoneCall"
  | "video"
  | "x"
  | "check"
  | "chevronDown"
  | "chevronUp"
  | "chevronLeft"
  | "chevronRight"
  | "dots"
  | "pin"
  | "archive"
  | "mute"
  | "block"
  | "flag"
  | "shield"
  | "chart"
  | "sparkles"
  | "send"
  | "paperclip"
  | "smile"
  | "edit"
  | "trash"
  | "eye"
  | "eyeOff"
  | "lock"
  | "key"
  | "mail"
  | "calendar"
  | "clock"
  | "link"
  | "download"
  | "upload"
  | "filter"
  | "refresh"
  | "alert"
  | "info"
  | "wifi"
  | "wifiOff"
  | "monitor"
  | "tablet";

type IconDef = { paths: string[]; circles?: string[]; filled?: boolean };

/** Path data on a 24×24 grid (stroke-based unless `filled`). */
const ICONS: Record<IconName, IconDef> = {
  home: {
    paths: [
      "M3 10.5 12 3l9 7.5",
      "M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5",
      "M9.5 21v-6h5v6",
    ],
  },
  globe: {
    circles: ["12 12 9"],
    paths: ["M3 12h18", "M12 3c2.9 3.6 2.9 14.4 0 18", "M12 3c-2.9 3.6-2.9 14.4 0 18"],
  },
  message: {
    paths: [
      "M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.8-.3-4-.9L3 21l1.9-4.6A8.5 8.5 0 1 1 21 11.5z",
    ],
  },
  bell: {
    paths: [
      "M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9",
      "M10.3 20a2 2 0 0 0 3.4 0",
    ],
  },
  user: {
    circles: ["12 8 4"],
    paths: ["M4 21c.8-3.9 4-6 8-6s7.2 2.1 8 6"],
  },
  users: {
    circles: ["9 8 3.5", "16.5 9.5 2.5"],
    paths: [
      "M2.5 20c.7-3.4 3.3-5.2 6.5-5.2s5.8 1.8 6.5 5.2",
      "M16 5.6a3.5 3.5 0 0 1 0 6.8",
      "M17.5 15.2c2 .6 3.5 2 4 4.8",
    ],
  },
  building: {
    paths: [
      "M4 21V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16",
      "M16 9h3a1 1 0 0 1 1 1v11",
      "M2 21h20",
      "M8 8h2M8 12h2M8 16h2M12 8h0M12 12h0M12 16h0",
    ],
  },
  search: {
    circles: ["11 11 7"],
    paths: ["m21 21-4.3-4.3"],
  },
  settings: {
    circles: ["12 12 3"],
    paths: [
      "M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1",
    ],
  },
  help: {
    circles: ["12 12 9"],
    paths: ["M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.7-3 4.5", "M12 17.5h.01"],
  },
  logout: {
    paths: [
      "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",
      "m16 17 5-5-5-5",
      "M21 12H9",
    ],
  },
  plus: { paths: ["M12 5v14", "M5 12h14"] },
  heart: {
    paths: [
      "M12 20.7C6.4 17 3 13.6 3 9.9 3 7.2 5.1 5 7.8 5c1.7 0 3.2.9 4.2 2.3C13 5.9 14.5 5 16.2 5 18.9 5 21 7.2 21 9.9c0 3.7-3.4 7.1-9 10.8z",
    ],
  },
  comment: {
    paths: [
      "M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12z",
      "M8.5 11h7M8.5 14h4",
    ],
  },
  share: {
    circles: ["6 12 2.5", "18 6 2.5", "18 18 2.5"],
    paths: ["m8.2 10.8 7.6-3.6", "m8.2 13.2 7.6 3.6"],
  },
  bookmark: { paths: ["M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z"] },
  image: {
    paths: [
      "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
      "m21 15-4.5-4.5L6 21",
    ],
    circles: ["9 9 2"],
  },
  mic: {
    paths: [
      "M9 3h6a1 1 0 0 1 1 1v10a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3V4a1 1 0 0 1 1-1z",
      "M5 11a7 7 0 0 0 14 0",
      "M12 18v3",
    ],
  },
  micOff: {
    paths: [
      "M9 3h6a1 1 0 0 1 1 1v7",
      "M5 11a7 7 0 0 0 12.5 4.3",
      "M12 18v3",
      "m2 2 20 20",
    ],
  },
  phone: {
    paths: [
      "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z",
    ],
  },
  phoneOff: {
    paths: [
      "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z",
      "m2 2 20 20",
    ],
  },
  phoneCall: {
    paths: [
      "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z",
      "M14.5 5.5a4.5 4.5 0 0 1 4 4",
      "M14.5 1.5a8.5 8.5 0 0 1 8 8",
    ],
  },
  video: {
    paths: [
      "m22 8-6 4 6 4V8z",
      "M2 6h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z",
    ],
  },
  x: { paths: ["M18 6 6 18", "m6 6 12 12"] },
  check: { paths: ["M20 6 9 17l-5-5"] },
  chevronDown: { paths: ["m6 9 6 6 6-6"] },
  chevronUp: { paths: ["m18 15-6-6-6 6"] },
  chevronLeft: { paths: ["m15 18-6-6 6-6"] },
  chevronRight: { paths: ["m9 18 6-6-6-6"] },
  dots: {
    filled: true,
    circles: ["5 12 1.4", "12 12 1.4", "19 12 1.4"],
    paths: [],
  },
  pin: {
    circles: ["12 10 2.5"],
    paths: ["M12 21.5s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"],
  },
  archive: {
    paths: [
      "M3 4h18a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z",
      "M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9",
      "M10 13h4",
    ],
  },
  mute: {
    paths: [
      "M11 5 6 9H2v6h4l5 4V5z",
      "m23 9-6 6",
      "m17 9 6 6",
    ],
  },
  block: {
    circles: ["12 12 9"],
    paths: ["m5.6 5.6 12.8 12.8"],
  },
  flag: { paths: ["M4 22V4c4-2.5 8 2.5 12 0v9c-4 2.5-8-2.5-12 0"] },
  shield: {
    paths: ["M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10z"],
  },
  chart: {
    paths: ["M3 3v16a2 2 0 0 0 2 2h16", "M8 17v-5", "M13 17V8", "M18 17v-8"],
  },
  sparkles: {
    paths: [
      "M12 4l1.7 5.3L19 11l-5.3 1.7L12 18l-1.7-5.3L5 11l5.3-1.7z",
      "M19 3.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z",
    ],
  },
  send: {
    paths: ["m22 2-7 20-4-9-9-4z", "M22 2 11 13"],
  },
  paperclip: {
    paths: [
      "m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l8.6-8.6a4 4 0 1 1 5.6 5.6l-8.6 8.6a2 2 0 0 1-2.8-2.8l8.5-8.5",
    ],
  },
  smile: {
    circles: ["12 12 9"],
    paths: ["M8 14.5s1.5 2 4 2 4-2 4-2", "M9 9.5h.01", "M15 9.5h.01"],
  },
  edit: {
    paths: ["M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"],
  },
  trash: {
    paths: [
      "M3 6h18",
      "M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2",
      "m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
      "M10 11v6M14 11v6",
    ],
  },
  eye: {
    paths: ["M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"],
    circles: ["12 12 3"],
  },
  eyeOff: {
    paths: [
      "M9.9 4.24A9.5 9.5 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.16 3.19",
      "M6.61 6.61A16.8 16.8 0 0 0 2 12s3.5 8 10 8a9.9 9.9 0 0 0 5.39-1.61",
      "m2 2 20 20",
      "M9.88 9.88a3 3 0 1 0 4.24 4.24",
    ],
  },
  lock: {
    paths: [
      "M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z",
      "M8 11V7a4 4 0 0 1 8 0v4",
    ],
  },
  // Key: the bow is a circle, the shaft and two teeth a diagonal — used for
  // one-time codes, where the code *is* the key to the pending action.
  key: {
    circles: ["7 17 4"],
    paths: ["m10 14 11-11", "m16.8 7.2 2.2 2.2", "m13.6 10.4 2.2 2.2"],
  },
  // Envelope: body outline plus the fold. Drawn as a closed path rather than a
  // rect so the corners match the rest of the set.
  mail: {
    paths: [
      "M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5z",
      "m3.6 7 8.4 6 8.4-6",
    ],
  },
  calendar: {
    paths: [
      "M8 2v4M16 2v4",
      "M3 8h18",
      "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
    ],
  },
  clock: {
    circles: ["12 12 9"],
    paths: ["M12 7v5l3 2"],
  },
  link: {
    paths: [
      "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7",
      "M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
    ],
  },
  download: {
    paths: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3"],
  },
  upload: {
    paths: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m17 8-5-5-5 5", "M12 3v12"],
  },
  filter: { paths: ["M22 3H2l8 9.5V19l4 2v-8.5z"] },
  refresh: {
    paths: ["M21 12a9 9 0 1 1-2.64-6.36", "M21 3v6h-6"],
  },
  alert: {
    paths: [
      "M12 3 2.5 20h19L12 3z",
      "M12 10v4",
      "M12 17.5h.01",
    ],
  },
  info: {
    circles: ["12 12 9"],
    paths: ["M12 11v5", "M12 8h.01"],
  },
  wifi: {
    paths: [
      "M5 13a10 10 0 0 1 14 0",
      "M8.5 16.5a5 5 0 0 1 7 0",
      "M2 9.5a15 15 0 0 1 20 0",
      "M12 20h.01",
    ],
  },
  wifiOff: {
    paths: [
      "m2 2 20 20",
      "M8.5 16.5a5 5 0 0 1 7 0",
      "M5 13a10 10 0 0 1 5.2-2.8",
      "M2 9.5a15 15 0 0 1 6.4-3.6",
      "M12 20h.01",
    ],
  },
  // Device glyphs for the sessions list — a desktop session used to be drawn
  // with the generic "info" glyph, so every device looked identical.
  monitor: {
    paths: [
      "M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z",
      "M9 20h6",
      "M12 16v4",
    ],
  },
  tablet: {
    paths: [
      "M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z",
      "M11 18.5h2",
    ],
  },
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  /** Rendered size in px (grid is always 24). Defaults to 20. */
  size?: number;
  strokeWidth?: number;
}

/**
 * Stroke icon renderer. Decorative by default (`aria-hidden`); pass
 * `aria-label` (and remove aria-hidden via `role="img"`) for meaningful icons.
 */
export function Icon({
  name,
  size = 20,
  strokeWidth = 2,
  className,
  ...rest
}: IconProps) {
  const def = ICONS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={def.filled ? "currentColor" : "none"}
      stroke={def.filled ? "none" : "currentColor"}
      strokeWidth={def.filled ? undefined : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={rest["aria-label"] ? undefined : true}
      focusable="false"
      className={cn("shrink-0", className)}
      {...rest}
    >
      {def.paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
      {def.circles?.map((c, i) => {
        const [cx, cy, r] = c.split(" ").map(Number);
        return <circle key={i} cx={cx} cy={cy} r={r} />;
      })}
    </svg>
  );
}
