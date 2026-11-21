import { create } from 'zustand';

import { pruneSelection, selectRange, toggleSelection } from './taskSelectionModel';

interface TaskSelectionState {
  /** Last row clicked without Shift — where the next Shift+click range starts. */
  anchorId?: string;
  panelOpen: boolean;
  /**
   * Rows a settled batch hands back for a retry that the list does not show
   * yet (its rollback has not rendered). The list's next `prune` selects the
   * ones it then shows and drops this; any selection change drops it too.
   */
  pendingRestore?: readonly string[];
  /** A batch is in flight: `done` of `total` tasks sent so far. */
  progress?: { done: number; total: number };
  /**
   * Bumped by every selection change the user (or `clear`) makes — not by
   * `prune`. A settled batch restores rows only when nothing changed since it
   * started: select-then-deselect leaves an empty selection, but the user has
   * still moved on.
   */
  revision: number;
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
   * selection changed at all since `revision`. Rows not on screen yet wait for
   * the next `prune`.
   */
  restore: (ids: readonly string[], revision: number) => void;
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
      panelOpen: false,
      pendingRestore: undefined,
      revision: state.revision + 1,
      // A batch still in flight belongs to the selection being dropped: the
      // list that comes next must not show its progress or stay frozen by it.
      progress: undefined,
      selectedIds: EMPTY,
    })),
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
  restore: (ids, revision) =>
    set((state) => {
      if (state.revision !== revision || state.selectedIds.length > 0) return state;
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
        : {
            anchorId: order[0],
            pendingRestore: undefined,
            revision: state.revision + 1,
            selectedIds: [...order],
          },
    ),
  selectRange: (order, id) =>
    set((state) =>
      state.progress
        ? state
        : {
            pendingRestore: undefined,
            revision: state.revision + 1,
            selectedIds: selectRange(order, state.selectedIds, state.anchorId, id),
          },
    ),
  revision: 0,
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
            revision: state.revision + 1,
            selectedIds: toggleSelection(state.selectedIds, id),
          },
    ),
  visibleIds: EMPTY_SET,
}));
