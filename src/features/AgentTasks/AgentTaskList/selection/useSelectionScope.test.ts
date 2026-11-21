import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useTaskSelectionStore } from './store';
import { useSelectionScope } from './useSelectionScope';

afterEach(() => useTaskSelectionStore.getState().clear());

describe('useSelectionScope', () => {
  it('keeps the selection while the scope is unchanged', () => {
    const { rerender } = renderHook(({ scope }) => useSelectionScope(scope), {
      initialProps: { scope: 'mine:assigned:1' },
    });
    useTaskSelectionStore.getState().selectAll(['shared-task']);

    rerender({ scope: 'mine:assigned:1' });

    expect(useTaskSelectionStore.getState().selectedIds).toEqual(['shared-task']);
  });

  it('drops a selection shared by two collections when switching between them', () => {
    const { rerender } = renderHook(({ scope }) => useSelectionScope(scope), {
      initialProps: { scope: 'mine:assigned:1' },
    });
    useTaskSelectionStore.getState().prune(new Set(['shared-task']));
    useTaskSelectionStore.getState().selectAll(['shared-task']);

    // "My created" also contains the task, so a prune alone would keep it.
    rerender({ scope: 'mine:created:1' });

    expect(useTaskSelectionStore.getState().selectedIds).toEqual([]);
  });

  it('clears on unmount', () => {
    const { unmount } = renderHook(() => useSelectionScope('scheduled::1'));
    useTaskSelectionStore.getState().selectAll(['a']);
    unmount();
    expect(useTaskSelectionStore.getState().selectedIds).toEqual([]);
  });
});
