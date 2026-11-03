import { create } from 'zustand';

import { pruneSelection, selectRange, toggleSelection } from './taskSelectionModel';

interface TaskSelectionState {
  /** Last row clicked without Shift — where the next Shift+click range starts. */
  anchorId?: string;
  /**
   * Bumped by every `clear()` — leaving the list, switching collection, Esc.
   * A batch that finishes after its selection was cleared must not write that
   * selection back into whatever list is on screen now.
   */
  generation: number;
  panelOpen: boolean;
  /**
   * Rows a settled batch hands back for a retry that the list does not show
   * yet (its rollback has not rendered). The list's next `prune` selects the
   * ones it then shows and drops this; any selection change drops it too.
   */
  pendingRestore?: readonly string[];
  /** A batch is in flight: `done` of `total` tasks sent so far. */
  progress?: { done: number; total: number };
  selectedIds: readonly string[];
  /**
   * Selectable rows of the list on screen, as last reported by `prune`. A batch
   * only ever writes ids from this set back into the selection, so ids from a
   * list or page that is no longer shown can never become invisibly selected.
   */
  visibleIds: ReadonlySet<string>;
}

interface TaskSelectionActions {
  clear: () => void;
  prune: (visibleIds: ReadonlySet<string>) => void;
  /**
   * Re-select a settled batch's rows that still need attention, unless the
   * selection moved on since `generation` (cleared, or the user selected
   * something). Rows not on screen yet wait for the next `prune`.
   */
  restore: (ids: readonly string[], generation: number) => void;
  selectAll: (order: readonly string[]) => void;
  selectRange: (order: readonly string[], id: string) => void;
  setPanelOpen: (open: boolean) => void;
  setProgress: (progress?: { done: number; total: number }) => void;
  toggle: (id: string) => void;
}

const EMPTY: readonly string[] = [];
const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Multi-select of the task list. One list is on screen at a time, so a single
 * store is enough; `TaskList` clears it when it unmounts or its collection
 * changes.
 */
export const useTaskSelectionStore = create<TaskSelectionState & TaskSelectionActions>((set) => ({
  anchorId: undefined,
  clear: () =>
    set((state) => ({
      anchorId: undefined,
      generation: state.generation + 1,
      panelOpen: false,
      pendingRestore: undefined,
      // A batch still in flight belongs to the selection being dropped: the
      // list that comes next must not show its progress or stay frozen by it.
      progress: undefined,
      selectedIds: EMPTY,
    })),
  generation: 0,
  panelOpen: false,
  pendingRestore: undefined,
  prune: (visibleIds) =>
    set((state) => {
      let selectedIds = pruneSelection(state.selectedIds, visibleIds);
      if (state.pendingRestore) {
        const restored = state.pendingRestore.filter(
          (id) => visibleIds.has(id) && !selectedIds.includes(id),
        );
        if (restored.length > 0) selectedIds = [...selectedIds, ...restored];
        return {
          panelOpen: state.panelOpen && selectedIds.length > 0,
          pendingRestore: undefined,
          selectedIds,
          visibleIds,
        };
      }
      if (selectedIds === state.selectedIds) return { visibleIds };
      return { panelOpen: state.panelOpen && selectedIds.length > 0, selectedIds, visibleIds };
    }),
  restore: (ids, generation) =>
    set((state) => {
      if (state.generation !== generation || state.selectedIds.length > 0) return state;
      const shown = ids.filter((id) => state.visibleIds.has(id));
      const later = ids.filter((id) => !state.visibleIds.has(id));
      return {
        pendingRestore: later.length > 0 ? later : undefined,
        selectedIds: shown.length > 0 ? shown : state.selectedIds,
      };
    }),
  // While a batch runs the selection is frozen: the batch acts on the ids it
  // snapshotted and writes the outcome back when it ends, so a change made in
  // between would be silently overwritten.
  selectAll: (order) =>
    set((state) =>
      state.progress
        ? state
        : { anchorId: order[0], pendingRestore: undefined, selectedIds: [...order] },
    ),
  selectRange: (order, id) =>
    set((state) =>
      state.progress
        ? state
        : {
            pendingRestore: undefined,
            selectedIds: selectRange(order, state.selectedIds, state.anchorId, id),
          },
    ),
  selectedIds: EMPTY,
  setPanelOpen: (panelOpen) => set((state) => ({ panelOpen: panelOpen && !state.progress })),
  setProgress: (progress) => set({ panelOpen: false, progress }),
  toggle: (id) =>
    set((state) =>
      state.progress
        ? state
        : {
            anchorId: id,
            pendingRestore: undefined,
            selectedIds: toggleSelection(state.selectedIds, id),
          },
    ),
  visibleIds: EMPTY_SET,
}));
