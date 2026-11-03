import { afterEach, describe, expect, it } from 'vitest';

import { useTaskSelectionStore } from './store';

afterEach(() => {
  useTaskSelectionStore.getState().clear();
  useTaskSelectionStore.setState({ progress: undefined });
});

describe('useTaskSelectionStore', () => {
  it('bumps the generation on every clear so a late batch can tell its scope is gone', () => {
    const store = useTaskSelectionStore.getState();
    store.selectAll(['a', 'b']);
    const before = useTaskSelectionStore.getState().generation;

    store.clear();

    const after = useTaskSelectionStore.getState();
    expect(after.selectedIds).toEqual([]);
    expect(after.generation).toBe(before + 1);
  });

  it('keeps the generation while the selection only changes within the list', () => {
    const store = useTaskSelectionStore.getState();
    const before = store.generation;
    store.toggle('a');
    store.selectRange(['a', 'b', 'c'], 'c');
    store.prune(new Set(['a', 'b']));

    const state = useTaskSelectionStore.getState();
    expect(state.selectedIds).toEqual(['a', 'b']);
    expect(state.generation).toBe(before);
  });

  it('does not open the panel while a batch is running', () => {
    const store = useTaskSelectionStore.getState();
    store.setProgress({ done: 0, total: 3 });
    store.setPanelOpen(true);
    expect(useTaskSelectionStore.getState().panelOpen).toBe(false);
  });

  describe('restore', () => {
    const settle = (visible: string[]) => {
      const store = useTaskSelectionStore.getState();
      store.clear();
      store.prune(new Set(visible));
      return useTaskSelectionStore.getState().generation;
    };

    it('selects shown rows now and hidden ones once the list shows them again', () => {
      // `b` was hidden by the overlay (e.g. moved to a status the view hides).
      const generation = settle(['a', 'c']);
      useTaskSelectionStore.getState().restore(['a', 'b'], generation);
      expect(useTaskSelectionStore.getState().selectedIds).toEqual(['a']);

      // The rollback renders: the list prunes with `b` back in it.
      useTaskSelectionStore.getState().prune(new Set(['a', 'b', 'c']));
      expect(useTaskSelectionStore.getState().selectedIds).toEqual(['a', 'b']);
      expect(useTaskSelectionStore.getState().pendingRestore).toBeUndefined();
    });

    it('drops pending rows the next list render does not show', () => {
      const generation = settle([]);
      useTaskSelectionStore.getState().restore(['a'], generation);
      useTaskSelectionStore.getState().prune(new Set(['x']));
      useTaskSelectionStore.getState().prune(new Set(['a', 'x']));
      expect(useTaskSelectionStore.getState().selectedIds).toEqual([]);
    });

    it('leaves a selection the user moved on to alone', () => {
      const generation = settle(['a', 'b']);
      useTaskSelectionStore.getState().toggle('b');
      useTaskSelectionStore.getState().restore(['a'], generation);
      expect(useTaskSelectionStore.getState().selectedIds).toEqual(['b']);

      useTaskSelectionStore.getState().clear();
      useTaskSelectionStore.getState().restore(['a'], generation);
      expect(useTaskSelectionStore.getState().selectedIds).toEqual([]);
    });

    it('forgets pending rows when the user selects before the list renders', () => {
      const generation = settle(['c']);
      useTaskSelectionStore.getState().restore(['a'], generation);
      useTaskSelectionStore.getState().toggle('c');
      useTaskSelectionStore.getState().prune(new Set(['a', 'c']));
      expect(useTaskSelectionStore.getState().selectedIds).toEqual(['c']);
    });
  });
});
