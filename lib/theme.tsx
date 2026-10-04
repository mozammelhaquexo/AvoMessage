"use client";

/**
 * AvoMessage theme system.
 *
 * Two independent, persisted axes:
 *
 *   1. Mode        — light / dark / system          (`avo-theme`)
 *   2. Palette     — accent hue + surface tone + corner radius, chosen
 *                    SEPARATELY for light and dark  (`avo-palette`)
 *
 * - The resolved mode drives the `.dark` class on `<html>`.
 * - The palette drives three data attributes on `<html>`: `data-accent`,
 *   `data-surface`, `data-radius`. `globals.css` §8 turns those into token
 *   overrides, so switching a preset is a single attribute write — no
 *   inline styles, no re-render of the tree, and no FOUC.
 * - `ThemeScript` runs before first paint and applies BOTH axes, so the
 *   stored mode *and* palette are on screen immediately.
 * - When mode is `system`, we follow the OS preference live via `matchMedia`;
 *   the palette then follows whichever mode is resolved.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** Brand hue families. `avocado` is the shipped default. */
export type AccentId =
  | "avocado"
  | "emerald"
  | "ocean"
  | "violet"
  | "rose"
  | "amber"
  | "graphite";

/** Canvas / surface tones. Light and dark have different, deliberately
 *  different-feeling sets — that is the point of the per-mode split. */
export type SurfaceId =
  | "warm"
  | "neutral"
  | "cool"
  | "forest"
  | "graphite"
  | "midnight";

/** Corner roundness. */
export type RadiusId = "sharp" | "default" | "round";

export interface ModePalette {
  accent: AccentId;
  surface: SurfaceId;
}

export interface PalettePrefs {
  light: ModePalette;
  dark: ModePalette;
  radius: RadiusId;
}

export const THEME_STORAGE_KEY = "avo-theme";
export const PALETTE_STORAGE_KEY = "avo-palette";

export const ACCENT_IDS: AccentId[] = [
  "avocado",
  "emerald",
  "ocean",
  "violet",
  "rose",
  "amber",
  "graphite",
];

export const LIGHT_SURFACE_IDS: SurfaceId[] = ["warm", "neutral", "cool"];
export const DARK_SURFACE_IDS: SurfaceId[] = ["forest", "graphite", "midnight"];
export const RADIUS_IDS: RadiusId[] = ["sharp", "default", "round"];

/** Swatch colour per accent, for the picker UI (light mode representative). */
export const ACCENT_SWATCH: Record<AccentId, string> = {
  avocado: "#65a30d",
  emerald: "#059669",
  ocean: "#0369a1",
  violet: "#7c3aed",
  rose: "#e11d48",
  amber: "#d97706",
  graphite: "#57534e",
};

/** Swatch colours for the surface presets (canvas + surface-2 pair). */
export const SURFACE_SWATCH: Record<SurfaceId, [string, string]> = {
  warm: ["#f7f6f1", "#f1efe7"],
  neutral: ["#f7f7f7", "#f0f0f0"],
  cool: ["#f5f7fa", "#eceff4"],
  forest: ["#0c0f0a", "#1b211a"],
  graphite: ["#0d0d0e", "#1c1c1f"],
  midnight: ["#080b14", "#161c2b"],
};

export const DEFAULT_PALETTE: PalettePrefs = {
  light: { accent: "avocado", surface: "warm" },
  dark: { accent: "avocado", surface: "forest" },
  radius: "default",
};

interface ThemeContextValue {
  /** The user's stored mode preference. */
  theme: Theme;
  /** The effective mode after resolving "system". */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;

  /** Accent + surface + radius, chosen per mode. */
  palette: PalettePrefs;
  /** Patch the palette for one mode (or both by calling twice). */
  setModePalette: (mode: ResolvedTheme, patch: Partial<ModePalette>) => void;
  setRadius: (radius: RadiusId) => void;
  resetPalette: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function isAccent(value: unknown): value is AccentId {
  return typeof value === "string" && (ACCENT_IDS as string[]).includes(value);
}

function isSurface(value: unknown): value is SurfaceId {
  return (
    typeof value === "string" &&
    [...LIGHT_SURFACE_IDS, ...DARK_SURFACE_IDS].includes(value as SurfaceId)
  );
}

function isRadius(value: unknown): value is RadiusId {
  return typeof value === "string" && (RADIUS_IDS as string[]).includes(value);
}

/** Parse + sanitise the stored palette. Unknown ids fall back per-field so a
 *  partially corrupted value can never leave the UI in an unstyleable state. */
export function normalizePalette(raw: unknown): PalettePrefs {
  const out: PalettePrefs = {
    light: { ...DEFAULT_PALETTE.light },
    dark: { ...DEFAULT_PALETTE.dark },
    radius: DEFAULT_PALETTE.radius,
  };
  if (!raw || typeof raw !== "object") return out;
  const value = raw as Partial<PalettePrefs>;
  if (isAccent(value.light?.accent)) out.light.accent = value.light.accent;
  if (isSurface(value.light?.surface)) out.light.surface = value.light.surface;
  if (isAccent(value.dark?.accent)) out.dark.accent = value.dark.accent;
  if (isSurface(value.dark?.surface)) out.dark.surface = value.dark.surface;
  if (isRadius(value.radius)) out.radius = value.radius;
  // Guard against cross-mode ids (e.g. a light surface stored for dark mode).
  if (!LIGHT_SURFACE_IDS.includes(out.light.surface)) {
    out.light.surface = DEFAULT_PALETTE.light.surface;
  }
  if (!DARK_SURFACE_IDS.includes(out.dark.surface)) {
    out.dark.surface = DEFAULT_PALETTE.dark.surface;
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * External stores — theme, palette and OS colour scheme
 *
 * All three live in the browser, so their values are unknowable during SSR.
 * `useSyncExternalStore` is the React-sanctioned way to read them: React uses
 * the `getServerSnapshot` value for the server render *and* for the hydration
 * pass, then re-renders with the real snapshot. A plain `useState` initialiser
 * instead reads localStorage during hydration, produces markup that differs
 * from what the server sent, and forces React to throw away and re-render the
 * entire tree (the "Hydration failed" error).
 * ------------------------------------------------------------------------- */

/** Same-tab subscribers; cross-tab writes arrive through the `storage` event. */
const storeListeners = new Set<() => void>();

function emitStoreChange() {
  for (const listener of storeListeners) listener();
}

function subscribeStore(callback: () => void) {
  storeListeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    storeListeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // storage blocked (private mode, cookies disabled, ...)
  }
}

function writeRaw(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked — the in-memory store still updates via emitStoreChange */
  }
}

function parsePalette(raw: string | null): PalettePrefs {
  if (!raw) return DEFAULT_PALETTE;
  try {
    return normalizePalette(JSON.parse(raw));
  } catch {
    return DEFAULT_PALETTE;
  }
}

// Snapshots must be primitives: React compares them with Object.is, and a
// freshly-allocated object on every read would re-render forever.
const getStoredTheme = () => readRaw(THEME_STORAGE_KEY);
const getStoredPalette = () => readRaw(PALETTE_STORAGE_KEY);
const getServerSnapshot = () => null;

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeSystemDark(callback: () => void) {
  const media = window.matchMedia(SYSTEM_DARK_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

const getSystemDark = () => window.matchMedia(SYSTEM_DARK_QUERY).matches;
/** The server cannot read the OS preference; "light" is the documented default. */
const getServerSystemDark = () => false;

function resolveSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(resolved: ResolvedTheme, palette: PalettePrefs) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  const mode = resolved === "dark" ? palette.dark : palette.light;
  root.dataset.accent = mode.accent;
  root.dataset.surface = mode.surface;
  root.dataset.radius = palette.radius;
}

/**
 * Inline script source for no-FOUC mode + palette application. Must run before
 * the browser paints; render `<ThemeScript />` as early as possible in <body>.
 *
 * Kept dependency-free and defensive: any failure leaves the default palette
 * (set in :root) in place rather than throwing and blocking the page.
 */
export const themeInitScript = `(function(){try{
var K=${JSON.stringify(THEME_STORAGE_KEY)},P=${JSON.stringify(PALETTE_STORAGE_KEY)};
var s=localStorage.getItem(K);
var d=s==="dark"||(s!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
var r=document.documentElement;
r.classList.toggle("dark",d);
var p=null;try{p=JSON.parse(localStorage.getItem(P)||"null");}catch(e){p=null;}
var m=(p&&(d?p.dark:p.light))||{};
r.dataset.accent=(m&&m.accent)||"avocado";
r.dataset.surface=(m&&m.surface)||(d?"forest":"warm");
r.dataset.radius=(p&&p.radius)||"default";
}catch(e){}})();`;

/**
 * Renders the no-FOUC inline theme script. Safe to use in Server Components.
 *
 * Pass the per-request CSP nonce (from the `x-nonce` request header set by
 * middleware) so the inline script satisfies the Content-Security-Policy.
 * Without a nonce the script is blocked by CSP and the page falls back to
 * the default theme until hydration — cosmetic only, never fatal.
 */
export function ThemeScript({ nonce }: { nonce?: string }) {
  return (
    <script
      nonce={nonce}
      // Runs synchronously before the rest of the body paints.
      dangerouslySetInnerHTML={{ __html: themeInitScript }}
    />
  );
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
}: {
  children: ReactNode;
  defaultTheme?: Theme;
}) {
  // Read the two persisted axes plus the live OS preference through
  // useSyncExternalStore, so the server snapshot is what the hydration pass
  // renders and the real value only lands on the render after that.
  const storedTheme = useSyncExternalStore(
    subscribeStore,
    getStoredTheme,
    getServerSnapshot,
  );
  const storedPalette = useSyncExternalStore(
    subscribeStore,
    getStoredPalette,
    getServerSnapshot,
  );
  const systemDark = useSyncExternalStore(
    subscribeSystemDark,
    getSystemDark,
    getServerSystemDark,
  );

  const theme: Theme = isTheme(storedTheme) ? storedTheme : defaultTheme;
  // Re-parsed only when the raw string changes, so the object identity stays
  // stable across renders and the apply-effect below does not re-run.
  const palette = useMemo(() => parsePalette(storedPalette), [storedPalette]);

  // Derive — never store — the resolved mode so render and the no-FOUC
  // script always agree without cascading renders.
  const resolvedTheme: ResolvedTheme =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;

  // Apply the class + palette attributes whenever either axis changes.
  useEffect(() => {
    applyTheme(resolvedTheme, palette);
  }, [resolvedTheme, palette]);

  // Writes go to localStorage, then notify the store so this tab re-reads it.
  // Cross-tab changes arrive through the `storage` listener in subscribeStore.
  const setTheme = useCallback((next: Theme) => {
    writeRaw(THEME_STORAGE_KEY, next);
    emitStoreChange();
  }, []);

  const toggleTheme = useCallback(() => {
    const raw = readRaw(THEME_STORAGE_KEY);
    const current: Theme = isTheme(raw) ? raw : defaultTheme;
    const resolved = current === "system" ? resolveSystemTheme() : current;
    setTheme(resolved === "dark" ? "light" : "dark");
  }, [defaultTheme, setTheme]);

  const setModePalette = useCallback(
    (mode: ResolvedTheme, patch: Partial<ModePalette>) => {
      const current = parsePalette(readRaw(PALETTE_STORAGE_KEY));
      const next: PalettePrefs = {
        ...current,
        [mode]: { ...current[mode], ...patch },
      };
      writeRaw(PALETTE_STORAGE_KEY, JSON.stringify(next));
      emitStoreChange();
    },
    [],
  );

  const setRadius = useCallback((radius: RadiusId) => {
    const current = parsePalette(readRaw(PALETTE_STORAGE_KEY));
    writeRaw(PALETTE_STORAGE_KEY, JSON.stringify({ ...current, radius }));
    emitStoreChange();
  }, []);

  const resetPalette = useCallback(() => {
    writeRaw(PALETTE_STORAGE_KEY, JSON.stringify(DEFAULT_PALETTE));
    emitStoreChange();
  }, []);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme,
      palette,
      setModePalette,
      setRadius,
      resetPalette,
    }),
    [
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme,
      palette,
      setModePalette,
      setRadius,
      resetPalette,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Access the current theme + palette. Must be inside `<ThemeProvider>`. */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
