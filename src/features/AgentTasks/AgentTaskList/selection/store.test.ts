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
});
