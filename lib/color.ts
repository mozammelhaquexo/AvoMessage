/**
 * lib/color.ts — tiny colour maths for the places where a colour is chosen at
 * runtime (user brand colours, palette swatch checkmarks) and we must pick
 * readable text for it. Everything here is pure and dependency-free.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Accepts `#rgb`, `#rrggbb` (with or without `#`). Returns null if unparseable. */
export function hexToRgb(hex: string): Rgb | null {
  if (typeof hex !== "string") return null;
  let value = hex.trim().replace(/^#/, "");
  if (value.length === 3) {
    value = value
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

/** WCAG 2.1 relative luminance (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
  );
}

/** WCAG contrast ratio between two colours (1 … 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Pick the readable ink for a background colour: `dark` when the background is
 * light enough, `light` otherwise. Defaults match the app's two ink tokens
 * (`--on-brand` and white). Returns `light` for unparseable input so the caller
 * always gets a usable colour.
 */
export function readableInkOn(
  background: string,
  dark = "#17210c",
  light = "#ffffff",
): string {
  if (!hexToRgb(background)) return light;
  // 4.5:1 is the WCAG AA floor for body text; prefer dark ink when it clears
  // the floor (matches the app's CTA convention of dark ink on brand fills).
  return contrastRatio(background, dark) >= 4.5 ? dark : light;
}
