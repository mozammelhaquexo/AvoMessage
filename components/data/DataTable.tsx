/**
 * components/data/DataTable.tsx — reusable data table.
 *
 * Columns with sorting, client-side pagination, row selection, row actions,
 * and an automatic card layout on mobile (tables → cards). All state is
 * controlled by the parent except internal page index when `pageSize` is set.
 */
"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button, EmptyState, Icon, LoadingState, Skeleton } from "@/components/ui";
import { cn } from "@/components/ui/utils";

/** Accessible native checkbox (the UI kit has no Checkbox primitive). */
function RowCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
      className="h-4 w-4 shrink-0 cursor-pointer accent-brand"
    />
  );
}

export interface DataTableColumn<T> {
  /** Stable key for the column. */
  key: string;
  header: ReactNode;
  /** Render the cell. */
  cell: (row: T) => ReactNode;
  /** Render the mobile card (defaults to stacking all cells). */
  card?: (row: T) => ReactNode;
  /** Enable sorting on this column via `sortValue`. */
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  /** Hide this column below the given breakpoint (mobile-first: cards). */
  hideOnMobile?: boolean;
  className?: string;
}

export interface DataTableAction<T> {
  id: string;
  label: string;
  icon?: Parameters<typeof Icon>[0]["name"];
  destructive?: boolean;
  /** Hide the action for a given row (e.g. permission-gated). */
  hidden?: (row: T) => boolean;
  disabled?: (row: T) => boolean;
  onSelect: (row: T) => void;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Stable row key. */
  rowKey: (row: T) => string;
  loading?: boolean;
  /** Row actions rendered as icon buttons (desktop) / in the card (mobile). */
  actions?: DataTableAction<T>[];
  /** Enable checkbox selection; reports selected rows. */
  selectable?: boolean;
  selectedKeys?: string[];
  onSelectionChange?: (keys: string[]) => void;
  /** Client-side page size; omit for no pagination. */
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  /** Accessible name for the table. */
  label: string;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  actions,
  selectable,
  selectedKeys,
  onSelectionChange,
  pageSize,
  emptyTitle = "No results",
  emptyDescription = "Try adjusting your search or filters.",
  emptyAction,
  label,
  className,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [rows, sortKey, sortDir, columns]);

  const pageCount = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const visible = pageSize ? sorted.slice(safePage * pageSize, safePage * pageSize + pageSize) : sorted;

  // Reset to first page when rows change (e.g. new search).
  const [lastRows, setLastRows] = useState(rows);
  if (lastRows !== rows) {
    setLastRows(rows);
    setPage(0);
  }

  const allSelected =
    selectable && visible.length > 0 && visible.every((r) => selectedKeys?.includes(rowKey(r)));

  function toggleRow(key: string) {
    if (!onSelectionChange) return;
    const next = selectedKeys?.includes(key)
      ? (selectedKeys ?? []).filter((k) => k !== key)
      : [...(selectedKeys ?? []), key];
    onSelectionChange(next);
  }

  function toggleSort(col: DataTableColumn<T>) {
    if (!col.sortable) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir("asc");
    }
  }

  function renderActions(row: T) {
    if (!actions?.length) return null;
    const items = actions.filter((a) => !a.hidden?.(row));
    if (items.length === 0) return null;
    return (
      <div className="flex items-center justify-end gap-1">
        {items.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => a.onSelect(row)}
            disabled={a.disabled?.(row)}
            aria-label={a.label}
            title={a.label}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-40",
              a.destructive
                ? "text-danger hover:bg-danger/10"
                : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            )}
          >
            {a.icon ? <Icon name={a.icon} size={16} aria-hidden /> : <span className="text-caption">{a.label}</span>}
          </button>
        ))}
      </div>
    );
  }

  if (loading) {
    return (
      <div className={className} role="status" aria-label={`Loading ${label}`}>
        <div className="hidden md:block">
          <LoadingState message={`Loading ${label.toLowerCase()}…`} compact />
        </div>
        <div className="flex flex-col gap-2 md:hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-lg border border-line bg-surface md:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="border-b border-line bg-surface-2/60">
              {selectable && (
                <th scope="col" className="w-10 px-3 py-2.5">
                  <RowCheckbox
                    checked={allSelected ?? false}
                    onChange={(checked) => {
                      if (!onSelectionChange) return;
                      const keys = visible.map(rowKey);
                      onSelectionChange(
                        checked ? [...new Set([...(selectedKeys ?? []), ...keys])] : (selectedKeys ?? []).filter((k) => !keys.includes(k)),
                      );
                    }}
                    label="Select all rows on this page"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={col.sortable ? (sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none") : undefined}
                  className={cn("px-3 py-2.5 text-caption font-semibold uppercase tracking-wider text-ink-2", col.className)}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col)}
                      className="flex items-center gap-1 hover:text-ink"
                      aria-label={`Sort by ${typeof col.header === "string" ? col.header : col.key}`}
                    >
                      {col.header}
                      <Icon
                        name={sortKey === col.key ? (sortDir === "asc" ? "chevronUp" : "chevronDown") : "chevronDown"}
                        size={12}
                        aria-hidden
                        className={cn(sortKey !== col.key && "opacity-30")}
                      />
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
              {actions && actions.length > 0 && (
                <th scope="col" className="px-3 py-2.5 text-right text-caption font-semibold uppercase tracking-wider text-ink-2">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const key = rowKey(row);
              const selected = selectedKeys?.includes(key);
              return (
                <tr key={key} className={cn("border-b border-line last:border-0 hover:bg-surface-2/40", selected && "bg-brand-soft/40")}>
                  {selectable && (
                    <td className="px-3 py-2.5">
                      <RowCheckbox checked={!!selected} onChange={() => toggleRow(key)} label={`Select row ${key}`} />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className={cn("px-3 py-2.5 text-body-sm text-ink", col.className)}>
                      {col.cell(row)}
                    </td>
                  ))}
                  {actions && actions.length > 0 && <td className="px-3 py-2.5">{renderActions(row)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 && (
          <EmptyState icon="search" title={emptyTitle} description={emptyDescription} compact className="py-10" />
        )}
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-2 md:hidden" role="list" aria-label={label}>
        {visible.map((row) => (
          <div key={rowKey(row)} role="listitem" className="rounded-lg border border-line bg-surface p-3">
            {columns.map((col) =>
              col.hideOnMobile ? null : col.card ? (
                <div key={col.key}>{col.card(row)}</div>
              ) : (
                <div key={col.key} className="py-0.5 text-body-sm">
                  {col.cell(row)}
                </div>
              ),
            )}
            {actions && actions.length > 0 && <div className="mt-2 border-t border-line pt-2">{renderActions(row)}</div>}
          </div>
        ))}
        {visible.length === 0 && (
          <EmptyState icon="search" title={emptyTitle} description={emptyDescription} compact />
        )}
      </div>
      {emptyAction && visible.length === 0 && <div className="mt-3 flex justify-center">{emptyAction}</div>}

      {/* Pagination */}
      {pageSize && pageCount > 1 && (
        <nav aria-label="Pagination" className="mt-3 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            aria-label="Previous page"
          >
            <Icon name="chevronLeft" size={14} aria-hidden />
          </Button>
          <span className="text-caption text-ink-2" role="status">
            Page {safePage + 1} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
            aria-label="Next page"
          >
            <Icon name="chevronRight" size={14} aria-hidden />
          </Button>
        </nav>
      )}
    </div>
  );
}
