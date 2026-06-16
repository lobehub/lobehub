import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { type FleetColumn, type FleetRows } from './types';

const clampRow = (row: number, rows: number) => Math.min(rows - 1, Math.max(0, row));

/** Even contiguous spread of keys across `rows` bands (first bands get the spare). */
const distributeRows = (keys: string[], rows: number): Record<string, number> => {
  const base = Math.floor(keys.length / rows);
  const remainder = keys.length % rows;
  const rowByKey: Record<string, number> = {};
  let cursor = 0;
  for (let band = 0; band < rows; band += 1) {
    const size = base + (band < remainder ? 1 : 0);
    for (let i = 0; i < size; i += 1) rowByKey[keys[cursor++]] = band;
  }
  return rowByKey;
};

interface FleetState {
  /**
   * Pin a column to the board (trailing "+" or a sidebar click). Dedupes by
   * key and clears any prior dismissal so a re-pinned topic sticks. Pass
   * `afterKey` to splice the new column right after an existing one (used by a
   * band's "+" so the column lands in that row instead of at the very end), and
   * `row` to assign its band (defaults to the least-full row for balance).
   */
  addColumn: (column: FleetColumn, afterKey?: string, row?: number) => void;
  /**
   * Ordered list of open columns. Persisted: manual pins and auto-added running
   * topics both live here and stay until the user closes them.
   */
  columns: FleetColumn[];
  /**
   * Running keys the user explicitly closed. Suppresses auto re-add while the
   * topic is still running; cleared once it stops (see syncRunningColumns).
   */
  dismissedKeys: string[];
  /**
   * Move a column to row `toRow` at the position of `overKey` (the multi-row
   * drag result): set its band assignment and splice it next to `overKey` in
   * the flat order. Every other column's band stays put, so a cross-row drag
   * inserts at the drop spot without reflowing/wrapping the rest of the board.
   */
  moveColumn: (activeKey: string, overKey: string | null, toRow: number) => void;
  /** Keys the user explicitly pinned — a deliberate "keep this column" marker. */
  pinnedKeys: string[];
  removeColumn: (key: string) => void;
  /** Reorder columns to match the given key order (from single-row drag). */
  reorderColumns: (orderedKeys: string[]) => void;
  /**
   * Per-column band assignment (which row a column lives in). Drives multi-row
   * grouping; persisted so the arrangement survives reloads.
   */
  rowByKey: Record<string, number>;
  /**
   * How many horizontal bands (rows) the board is split into. 1 = the classic
   * single-row layout; 2/3 stack columns into vertical tiers, each an
   * independently horizontal-scrolling band that splits the height evenly.
   */
  rows: FleetRows;
  setRows: (rows: FleetRows) => void;
  setWidth: (key: string, width: number) => void;
  /**
   * Reconcile the live running set into the board: append any running topic
   * that isn't already shown and wasn't dismissed while running. Never removes
   * or reorders existing columns, so manual pins and ordering are preserved.
   */
  syncRunningColumns: (running: FleetColumn[]) => void;
  /** Toggle a column's pinned state. */
  togglePin: (key: string) => void;
  /** Per-column widths, persisted so each column remembers its size. */
  widths: Record<string, number>;
}

export const useFleetStore = create<FleetState>()(
  persist(
    (set) => ({
      addColumn: (column, afterKey, row) =>
        set((s) => {
          const dismissedKeys = s.dismissedKeys.filter((k) => k !== column.key);
          if (s.columns.some((c) => c.key === column.key)) return { dismissedKeys };
          // Assign a band: the caller's row (a band's "+"), else the least-full
          // row so auto-added running topics spread out instead of piling up.
          const counts = Array.from({ length: s.rows }, () => 0);
          for (const c of s.columns) counts[clampRow(s.rowByKey[c.key] ?? 0, s.rows)] += 1;
          const targetRow =
            row === undefined ? counts.indexOf(Math.min(...counts)) : clampRow(row, s.rows);
          const rowByKey = { ...s.rowByKey, [column.key]: targetRow };
          const at = afterKey ? s.columns.findIndex((c) => c.key === afterKey) : -1;
          if (at < 0) return { columns: [...s.columns, column], dismissedKeys, rowByKey };
          const columns = [...s.columns];
          columns.splice(at + 1, 0, column);
          return { columns, dismissedKeys, rowByKey };
        }),
      columns: [],
      dismissedKeys: [],
      moveColumn: (activeKey, overKey, toRow) =>
        set((s) => {
          const rowByKey = { ...s.rowByKey, [activeKey]: clampRow(toRow, s.rows) };
          if (!overKey || overKey === activeKey) return { rowByKey };
          const from = s.columns.findIndex((c) => c.key === activeKey);
          if (from < 0) return { rowByKey };
          const columns = [...s.columns];
          const [moved] = columns.splice(from, 1);
          // Re-find the target after removal so the splice lands at over's slot.
          const to = columns.findIndex((c) => c.key === overKey);
          columns.splice(to < 0 ? columns.length : to, 0, moved);
          return { columns, rowByKey };
        }),
      pinnedKeys: [],
      removeColumn: (key) =>
        set((s) => {
          const { [key]: _removed, ...rowByKey } = s.rowByKey;
          return {
            columns: s.columns.filter((c) => c.key !== key),
            dismissedKeys: s.dismissedKeys.includes(key)
              ? s.dismissedKeys
              : [...s.dismissedKeys, key],
            pinnedKeys: s.pinnedKeys.filter((k) => k !== key),
            rowByKey,
          };
        }),
      reorderColumns: (orderedKeys) =>
        set((s) => {
          const byKey = new Map(s.columns.map((c) => [c.key, c]));
          const next = orderedKeys
            .map((key) => byKey.get(key))
            .filter((c): c is FleetColumn => Boolean(c));
          // Keep any columns missing from the order list (defensive) at the end.
          const seen = new Set(orderedKeys);
          for (const c of s.columns) if (!seen.has(c.key)) next.push(c);
          return { columns: next };
        }),
      rowByKey: {},
      rows: 1,
      // Changing the band count is a deliberate relayout — re-spread all columns
      // evenly across the new row count (preserving flat order).
      setRows: (rows) =>
        set((s) => ({
          rowByKey: distributeRows(
            s.columns.map((c) => c.key),
            rows,
          ),
          rows,
        })),
      setWidth: (key, width) => set((s) => ({ widths: { ...s.widths, [key]: width } })),
      togglePin: (key) =>
        set((s) => ({
          pinnedKeys: s.pinnedKeys.includes(key)
            ? s.pinnedKeys.filter((k) => k !== key)
            : [...s.pinnedKeys, key],
        })),
      syncRunningColumns: (running) =>
        set((s) => {
          const runningKeys = new Set(running.map((c) => c.key));
          // A dismissal only holds while the topic keeps running; once it stops
          // we drop it so a fresh run re-surfaces the column.
          const dismissedKeys = s.dismissedKeys.filter((k) => runningKeys.has(k));
          const dismissed = new Set(dismissedKeys);
          const existing = new Set(s.columns.map((c) => c.key));
          const additions = running.filter((c) => !existing.has(c.key) && !dismissed.has(c.key));
          const dismissedChanged = dismissedKeys.length !== s.dismissedKeys.length;
          if (additions.length === 0 && !dismissedChanged) return {};
          // Spread each new topic into the least-full band so auto-adds balance.
          const counts = Array.from({ length: s.rows }, () => 0);
          for (const c of s.columns) counts[clampRow(s.rowByKey[c.key] ?? 0, s.rows)] += 1;
          const rowByKey = { ...s.rowByKey };
          for (const c of additions) {
            const band = counts.indexOf(Math.min(...counts));
            rowByKey[c.key] = band;
            counts[band] += 1;
          }
          return {
            columns: additions.length > 0 ? [...s.columns, ...additions] : s.columns,
            dismissedKeys: dismissedChanged ? dismissedKeys : s.dismissedKeys,
            rowByKey: additions.length > 0 ? rowByKey : s.rowByKey,
          };
        }),
      widths: {},
    }),
    {
      // Columns, dismissals, and widths all persist so the board (manual pins +
      // running topics you've kept) and each column's size survive reloads.
      name: 'LOBE_FLEET_VIEW',
      partialize: (s) => ({
        columns: s.columns,
        dismissedKeys: s.dismissedKeys,
        pinnedKeys: s.pinnedKeys,
        rowByKey: s.rowByKey,
        rows: s.rows,
        widths: s.widths,
      }),
    },
  ),
);
