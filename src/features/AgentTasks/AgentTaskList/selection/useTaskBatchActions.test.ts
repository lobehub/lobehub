import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskSelectionStore } from './store';
import { useTaskBatchActions } from './useTaskBatchActions';

const batchUpdate = vi.fn();

vi.mock('@/services/task', () => ({
  taskService: { batchUpdate: (...args: unknown[]) => batchUpdate(...args) },
}));
vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (s: { refreshTaskList: () => Promise<void> }) => unknown) =>
    selector({ refreshTaskList: async () => {} }),
}));
vi.mock('@lobehub/ui', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const partialFailure = { failed: [{ error: 'boom', id: 'b' }], skipped: [], updated: ['a'] };

beforeEach(() => {
  batchUpdate.mockReset();
  useTaskSelectionStore.getState().clear();
  useTaskSelectionStore.setState({ progress: undefined });
});

afterEach(() => {
  useTaskSelectionStore.getState().clear();
});

describe('useTaskBatchActions', () => {
  it('keeps the failed tasks selected for a retry', async () => {
    batchUpdate.mockResolvedValue(partialFailure);
    useTaskSelectionStore.getState().selectAll(['a', 'b']);
    const { result } = renderHook(() => useTaskBatchActions());

    await act(() => result.current.run({ kind: 'update', patch: { priority: 1 } }));

    expect(useTaskSelectionStore.getState().selectedIds).toEqual(['b']);
    expect(useTaskSelectionStore.getState().progress).toBeUndefined();
  });

  it('does not restore a selection whose list was left while the batch ran', async () => {
    let resolve!: (value: typeof partialFailure) => void;
    batchUpdate.mockReturnValue(new Promise((r) => (resolve = r)));
    useTaskSelectionStore.getState().selectAll(['a', 'b']);
    const { result } = renderHook(() => useTaskBatchActions());

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.run({ kind: 'update', patch: { priority: 1 } });
    });
    // The user moves to another collection: TaskList's cleanup clears the store,
    // and the new list selects its own row.
    act(() => {
      useTaskSelectionStore.getState().clear();
      useTaskSelectionStore.getState().toggle('other-list-task');
    });
    await act(async () => {
      resolve(partialFailure);
      await pending;
    });

    expect(useTaskSelectionStore.getState().selectedIds).toEqual(['other-list-task']);
  });
});
