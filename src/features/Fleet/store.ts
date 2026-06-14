import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { type FleetColumn } from './types';

interface FleetState {
  /** Append a column to the right; no-op if its key is already open. */
  addColumn: (column: FleetColumn) => void;
  /** Ordered list of open columns. Ephemeral — re-seeded from running tasks per load. */
  columns: FleetColumn[];
  removeColumn: (key: string) => void;
  /** Reorder columns to match the given key order (from drag-and-drop). */
  reorderColumns: (orderedKeys: string[]) => void;
  /** Seed the default column set once per app load. No-op after the first seed. */
  seedColumns: (columns: FleetColumn[]) => void;
  seeded: boolean;
  setWidth: (key: string, width: number) => void;
  /** Per-column widths, persisted so each column remembers its size. */
  widths: Record<string, number>;
}

export const useFleetStore = create<FleetState>()(
  persist(
    (set, get) => ({
      addColumn: (column) => {
        if (get().columns.some((c) => c.key === column.key)) return;
        set((s) => ({ columns: [...s.columns, column] }));
      },
      columns: [],
      removeColumn: (key) => set((s) => ({ columns: s.columns.filter((c) => c.key !== key) })),
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
      seedColumns: (columns) => {
        if (get().seeded) return;
        set({ columns, seeded: true });
      },
      seeded: false,
      setWidth: (key, width) => set((s) => ({ widths: { ...s.widths, [key]: width } })),
      widths: {},
    }),
    {
      // Only widths persist across reloads; the column set re-seeds from
      // the live running-task list each time the view loads.
      name: 'LOBE_FLEET_VIEW',
      partialize: (s) => ({ widths: s.widths }),
    },
  ),
);
