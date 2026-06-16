import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { type FleetColumn } from './types';

interface FleetState {
  /**
   * Pin a column to the board (trailing "+" or a sidebar click). Dedupes by
   * key and clears any prior dismissal so a re-pinned topic sticks.
   */
  addColumn: (column: FleetColumn) => void;
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
  removeColumn: (key: string) => void;
  /** Reorder columns to match the given key order (from drag-and-drop). */
  reorderColumns: (orderedKeys: string[]) => void;
  setWidth: (key: string, width: number) => void;
  /**
   * Reconcile the live running set into the board: append any running topic
   * that isn't already shown and wasn't dismissed while running. Never removes
   * or reorders existing columns, so manual pins and ordering are preserved.
   */
  syncRunningColumns: (running: FleetColumn[]) => void;
  /** Per-column widths, persisted so each column remembers its size. */
  widths: Record<string, number>;
}

export const useFleetStore = create<FleetState>()(
  persist(
    (set) => ({
      addColumn: (column) =>
        set((s) => {
          const dismissedKeys = s.dismissedKeys.filter((k) => k !== column.key);
          if (s.columns.some((c) => c.key === column.key)) return { dismissedKeys };
          return { columns: [...s.columns, column], dismissedKeys };
        }),
      columns: [],
      dismissedKeys: [],
      removeColumn: (key) =>
        set((s) => ({
          columns: s.columns.filter((c) => c.key !== key),
          dismissedKeys: s.dismissedKeys.includes(key)
            ? s.dismissedKeys
            : [...s.dismissedKeys, key],
        })),
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
      setWidth: (key, width) => set((s) => ({ widths: { ...s.widths, [key]: width } })),
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
          return {
            columns: additions.length > 0 ? [...s.columns, ...additions] : s.columns,
            dismissedKeys: dismissedChanged ? dismissedKeys : s.dismissedKeys,
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
        widths: s.widths,
      }),
    },
  ),
);
