import { create } from 'zustand';

import { pruneSelection, selectRange, toggleSelection } from './taskSelectionModel';

interface TaskSelectionState {
  /** Last row clicked without Shift — where the next Shift+click range starts. */
  anchorId?: string;
  panelOpen: boolean;
  /** A batch is in flight: `done` of `total` tasks sent so far. */
  progress?: { done: number; total: number };
  selectedIds: readonly string[];
}

interface TaskSelectionActions {
  clear: () => void;
  prune: (visibleIds: ReadonlySet<string>) => void;
  selectAll: (order: readonly string[]) => void;
  selectRange: (order: readonly string[], id: string) => void;
  setPanelOpen: (open: boolean) => void;
  setProgress: (progress?: { done: number; total: number }) => void;
  toggle: (id: string) => void;
}

const EMPTY: readonly string[] = [];

/**
 * Multi-select of the task list. One list is on screen at a time, so a single
 * store is enough; `TaskList` clears it when it unmounts or its collection
 * changes.
 */
export const useTaskSelectionStore = create<TaskSelectionState & TaskSelectionActions>((set) => ({
  anchorId: undefined,
  clear: () => set({ anchorId: undefined, panelOpen: false, selectedIds: EMPTY }),
  panelOpen: false,
  prune: (visibleIds) =>
    set((state) => {
      const selectedIds = pruneSelection(state.selectedIds, visibleIds);
      if (selectedIds === state.selectedIds) return state;
      return { panelOpen: state.panelOpen && selectedIds.length > 0, selectedIds };
    }),
  selectAll: (order) => set({ anchorId: order[0], selectedIds: [...order] }),
  selectRange: (order, id) =>
    set((state) => ({ selectedIds: selectRange(order, state.selectedIds, state.anchorId, id) })),
  selectedIds: EMPTY,
  setPanelOpen: (panelOpen) => set((state) => ({ panelOpen: panelOpen && !state.progress })),
  setProgress: (progress) => set({ panelOpen: false, progress }),
  toggle: (id) =>
    set((state) => ({ anchorId: id, selectedIds: toggleSelection(state.selectedIds, id) })),
}));
