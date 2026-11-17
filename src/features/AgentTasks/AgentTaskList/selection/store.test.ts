import { afterEach, describe, expect, it } from 'vitest';

import { useTaskSelectionStore } from './store';

afterEach(() => {
  useTaskSelectionStore.getState().clear();
  useTaskSelectionStore.setState({ progress: undefined });
});

describe('useTaskSelectionStore', () => {
  it('bumps the revision on every user selection change and clear, not on prune', () => {
    const store = useTaskSelectionStore.getState();
    const at = () => useTaskSelectionStore.getState().revision;
    const start = at();
    store.toggle('a');
    store.selectRange(['a', 'b', 'c'], 'c');
    store.selectAll(['a', 'b']);
    expect(at()).toBe(start + 3);

    store.prune(new Set(['a']));
    expect(at()).toBe(start + 3);
    expect(useTaskSelectionStore.getState().selectedIds).toEqual(['a']);

    store.clear();
    expect(at()).toBe(start + 4);
    expect(useTaskSelectionStore.getState().selectedIds).toEqual([]);
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
      return useTaskSelectionStore.getState().revision;
    };

    it('selects shown rows now and hidden ones once the list shows them again', () => {
      // `b` was hidden by the overlay (e.g. moved to a status the view hides).
      const revision = settle(['a', 'c']);
      useTaskSelectionStore.getState().restore(['a', 'b'], revision);
      expect(useTaskSelectionStore.getState().selectedIds).toEqual(['a']);

      // The rollback renders: the list prunes with `b` back in it.
      useTaskSelectionStore.getState().prune(new Set(['a', 'b', 'c']));
      expect(useTaskSelectionStore.getState().selectedIds).toEqual(['a', 'b']);
      expect(useTaskSelectionStore.getState().pendingRestore).toBeUndefined();
    });

    it('drops pending rows the next list render does not show', () => {
      const revision = settle([]);
      useTaskSelectionStore.getState().restore(['a'], revision);
      useTaskSelectionStore.getState().prune(new Set(['x']));
      useTaskSelectionStore.getState().prune(new Set(['a', 'x']));
      expect(useTaskSelectionStore.getState().selectedIds).toEqual([]);
    });

    it('leaves a selection the user moved on to alone', () => {
      const revision = settle(['a', 'b']);
      useTaskSelectionStore.getState().toggle('b');
      useTaskSelectionStore.getState().restore(['a'], revision);
      expect(useTaskSelectionStore.getState().selectedIds).toEqual(['b']);

      useTaskSelectionStore.getState().clear();
      useTaskSelectionStore.getState().restore(['a'], revision);
      expect(useTaskSelectionStore.getState().selectedIds).toEqual([]);
    });

    it('does not restore after a select-then-deselect left the selection empty', () => {
      const revision = settle(['a', 'b']);
      useTaskSelectionStore.getState().toggle('b');
      useTaskSelectionStore.getState().toggle('b');
      useTaskSelectionStore.getState().restore(['a'], revision);
      expect(useTaskSelectionStore.getState().selectedIds).toEqual([]);
    });

    it('forgets pending rows when the user selects before the list renders', () => {
      const revision = settle(['c']);
      useTaskSelectionStore.getState().restore(['a'], revision);
      useTaskSelectionStore.getState().toggle('c');
      useTaskSelectionStore.getState().prune(new Set(['a', 'c']));
      expect(useTaskSelectionStore.getState().selectedIds).toEqual(['c']);
    });
  });
});
