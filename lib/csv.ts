/**
 * lib/csv.ts — CSV export helpers for the console tables.
 *
 * Two concerns, kept separate on purpose so the formatting rules can be unit
 * tested without a DOM:
 *
 *   1. `toCsv` turns rows into an RFC-4180 string (CRLF line endings, quotes
 *      doubled, fields quoted only when they need it).
 *   2. `downloadCsv` is the browser side — a Blob, an object URL and a
 *      synthetic anchor click, plus the UTF-8 BOM Excel needs to read
 *      non-ASCII (Bengali names, emoji) correctly.
 *
 * Everything exported here is derived from user-generated content, so
 * `toCsv` also neutralises spreadsheet formula injection: a cell that begins
 * with `=`, `+`, `@`, a tab or a carriage return is prefixed with an
 * apostrophe so Excel and Sheets treat it as text instead of executing it.
 */

export type CsvValue = string | number | boolean | Date | null | undefined;

export interface CsvColumn<T> {
  /** Column header, written verbatim into the first row. */
  header: string;
  /** Cell value for a row. */
  value: (row: T) => CsvValue;
}

/**
 * The characters a spreadsheet treats as the start of a formula.
 *
 * `-` is handled separately because a plain negative number is data, not a
 * payload; quoting it would corrupt the value.
 */
const FORMULA_LEAD = /^[=+@]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const LEADING_BLANKS = /^[ \t]+/;

function needsFormulaGuard(s: string): boolean {
  // Spreadsheets trim leading spaces and tabs before deciding a cell is a
  // formula, so `" \t=1+1"` is just as dangerous as `"=1+1"`. Look at what
  // actually leads the cell, not at raw offset 0.
  const lead = s.replace(LEADING_BLANKS, "");
  if (lead === "") return false;
  if (FORMULA_LEAD.test(lead)) return true;
  // "-2+3" evaluates in Excel; "-42" does not. Only guard the former.
  if (lead.startsWith("-")) return !PLAIN_NUMBER.test(lead);
  // A carriage return is not stripped above and is itself a formula lead.
  return lead.startsWith("\r");
}

function stringify(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return value;
}

/** Escape a single field. Exported for direct testing. */
export function csvField(value: CsvValue): string {
  let s = stringify(value);
  if (s !== "" && needsFormulaGuard(s)) s = `'${s}`;
  // Quote when the field contains a delimiter, a quote, a newline, or edge
  // whitespace that a naive parser would trim.
  const needsQuotes = /[",\r\n]/.test(s) || s !== s.trim();
  if (!needsQuotes) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Build an RFC-4180 CSV document.
 *
 * A row is emitted for every entry in `rows`; the header row is always first,
 * even when there is no data, so an empty export still opens with column names
 * instead of a blank file.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvField(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(c.value(row))).join(","));
  }
  return lines.join("\r\n");
}

/** A filesystem-safe filename stem (no extension). */
export function csvFilename(stem: string, at: Date = new Date()): string {
  const stamp = at.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const safe = stem.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "export";
  return `${safe}-${stamp}.csv`;
}

/**
 * Trigger a download of `csv` in the browser. No-op during SSR.
 *
 * The BOM (`\uFEFF`) is prepended because Excel on Windows otherwise decodes
 * UTF-8 as the system code page and mangles non-ASCII characters.
 */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick — Safari cancels the download if the URL dies
  // while the navigation is still being set up.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
