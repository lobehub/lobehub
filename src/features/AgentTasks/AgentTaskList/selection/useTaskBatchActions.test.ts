import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskSelectionStore } from './store';
import { useTaskBatchActions } from './useTaskBatchActions';

const batchUpdate = vi.fn();
const batchDelete = vi.fn();
const refreshTaskList = vi.fn(async () => {});
const toastWarning = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const overlay = { commit: vi.fn(), rollback: vi.fn() };
const beginOptimistic = vi.fn((..._args: unknown[]) => overlay);

vi.mock('@/services/task', () => ({
  taskService: {
    batchDelete: (...args: unknown[]) => batchDelete(...args),
    batchUpdate: (...args: unknown[]) => batchUpdate(...args),
  },
}));
vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ internal_beginCollectionTasksOptimistic: beginOptimistic, refreshTaskList }),
}));
vi.mock('@lobehub/ui', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const partialFailure = { failed: [{ error: 'boom', id: 'b' }], skipped: [], updated: ['a'] };

beforeEach(() => {
  batchUpdate.mockReset();
  batchDelete.mockReset();
  beginOptimistic.mockClear();
  overlay.commit.mockReset();
  overlay.rollback.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  refreshTaskList.mockReset();
  refreshTaskList.mockResolvedValue(undefined);
  toastWarning.mockReset();
  useTaskSelectionStore.getState().clear();
  useTaskSelectionStore.setState({ progress: undefined });
});

afterEach(() => {
  useTaskSelectionStore.getState().clear();
});

describe('useTaskBatchActions', () => {
  it('keeps the failed tasks selected for a retry', async () => {
    batchUpdate.mockResolvedValue(partialFailure);
    useTaskSelectionStore.getState().prune(new Set(['a', 'b', 'c']));
    useTaskSelectionStore.getState().selectAll(['a', 'b']);
    const { result } = renderHook(() => useTaskBatchActions());

    await act(() => result.current.run({ kind: 'update', patch: { priority: 1 } }));

    expect(useTaskSelectionStore.getState().selectedIds).toEqual(['b']);
    expect(useTaskSelectionStore.getState().progress).toBeUndefined();
    // Only the row the server changed keeps its optimistic patch.
    const [keep] = overlay.commit.mock.calls[0] as [Map<string, unknown>];
    expect([...keep.keys()]).toEqual(['a']);
  });

  it('shows the result and clears the selection before the server answers', async () => {
    let resolve!: (value: unknown) => void;
    batchUpdate.mockReturnValue(new Promise((r) => (resolve = r)));
    useTaskSelectionStore.getState().prune(new Set(['a', 'b']));
    useTaskSelectionStore.getState().selectAll(['a', 'b']);
    const { result } = renderHook(() => useTaskBatchActions());

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.run({ kind: 'update', patch: { priority: 1 } });
    });
    expect(beginOptimistic).toHaveBeenCalledWith(['a', 'b'], expect.any(Function));
    expect(useTaskSelectionStore.getState().selectedIds).toEqual([]);
    expect(overlay.commit).not.toHaveBeenCalled();

    await act(async () => {
      resolve({ failed: [], skipped: [], updated: ['a', 'b'] });
      await pending;
    });
    expect(overlay.commit).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it('does not wait for the list refresh before settling', async () => {
    batchUpdate.mockResolvedValue({ failed: [], skipped: [], updated: ['a'] });
    refreshTaskList.mockReturnValue(new Promise(() => {}));
    useTaskSelectionStore.getState().selectAll(['a']);
    const { result } = renderHook(() => useTaskBatchActions());

    await act(() => result.current.run({ kind: 'update', patch: { priority: 1 } }));

    expect(refreshTaskList).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it('rolls everything back and reselects the rows when the request fails', async () => {
    batchDelete.mockRejectedValue(new Error('offline'));
    useTaskSelectionStore.getState().prune(new Set(['a', 'b']));
    useTaskSelectionStore.getState().selectAll(['a', 'b']);
    const { result } = renderHook(() => useTaskBatchActions());

    act(() => {
      void result.current.run({ kind: 'delete' });
      // The deleted rows left the list: its prune drops them from `visibleIds`.
      useTaskSelectionStore.getState().prune(new Set());
    });
    await act(async () => {});

    expect(overlay.rollback).toHaveBeenCalledTimes(1);
    expect(overlay.commit).not.toHaveBeenCalled();
    expect(refreshTaskList).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('offline');
    // Selected again for a retry once the rolled-back rows render again.
    expect(useTaskSelectionStore.getState().selectedIds).toEqual([]);
    act(() => useTaskSelectionStore.getState().prune(new Set(['a', 'b'])));
    expect(useTaskSelectionStore.getState().selectedIds).toEqual(['a', 'b']);
  });

  it('sends batches to the server in click order', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    batchUpdate
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            releaseFirst = () => {
              order.push('first');
              r({ failed: [], skipped: [], updated: ['a'] });
            };
          }),
      )
      .mockImplementationOnce(async () => {
        order.push('second');
        return { failed: [], skipped: [], updated: ['a'] };
      });
    const { result } = renderHook(() => useTaskBatchActions());

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      useTaskSelectionStore.getState().selectAll(['a']);
      first = result.current.run({ kind: 'update', patch: { priority: 1 } });
      useTaskSelectionStore.getState().selectAll(['a']);
      second = result.current.run({ kind: 'update', patch: { priority: 2 } });
    });
    // Both already show; the second request waits for the first.
    expect(beginOptimistic).toHaveBeenCalledTimes(2);
    await act(async () => {});
    expect(batchUpdate).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseFirst();
      await Promise.all([first, second]);
    });
    expect(order).toEqual(['first', 'second']);
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
    // The new list is neither frozen nor showing the old batch's progress.
    expect(useTaskSelectionStore.getState().progress).toBeUndefined();
    await act(async () => {
      resolve(partialFailure);
      await pending;
    });

    expect(useTaskSelectionStore.getState().selectedIds).toEqual(['other-list-task']);
  });

  it('does not bring back ids of a page or scope the reused list no longer shows', async () => {
    let resolve!: (value: typeof partialFailure) => void;
    batchUpdate.mockReturnValue(new Promise((r) => (resolve = r)));
    useTaskSelectionStore.getState().prune(new Set(['a', 'b']));
    useTaskSelectionStore.getState().selectAll(['a', 'b']);
    const { result } = renderHook(() => useTaskBatchActions());

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.run({ kind: 'update', patch: { priority: 1 } });
    });
    // Same TaskList instance, next page: only the prune runs, no clear().
    act(() => useTaskSelectionStore.getState().prune(new Set(['x', 'y'])));
    await act(async () => {
      resolve(partialFailure);
      await pending;
    });

    expect(useTaskSelectionStore.getState().selectedIds).toEqual([]);
  });

  it('keeps a selection the user made while the batch ran', async () => {
    let resolve!: (value: typeof partialFailure) => void;
    batchUpdate.mockReturnValue(new Promise((r) => (resolve = r)));
    useTaskSelectionStore.getState().prune(new Set(['a', 'b', 'c']));
    useTaskSelectionStore.getState().selectAll(['a', 'b']);
    const { result } = renderHook(() => useTaskBatchActions());

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.run({ kind: 'update', patch: { priority: 1 } });
    });
    // The list is not frozen: the user goes on selecting.
    act(() => useTaskSelectionStore.getState().toggle('c'));

    await act(async () => {
      resolve(partialFailure);
      await pending;
    });
    expect(useTaskSelectionStore.getState().selectedIds).toEqual(['c']);
  });

  it('reports a failed list refresh after a committed batch, with a retry', async () => {
    batchUpdate.mockResolvedValue({ failed: [], skipped: [], updated: ['a', 'b'] });
    refreshTaskList.mockRejectedValueOnce(new Error('network down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useTaskSelectionStore.getState().prune(new Set(['a', 'b']));
    useTaskSelectionStore.getState().selectAll(['a', 'b']);
    const { result } = renderHook(() => useTaskBatchActions());

    await act(() => result.current.run({ kind: 'update', patch: { priority: 1 } }));
    await act(async () => {});

    const refreshWarning = toastWarning.mock.calls.find(
      ([arg]) => typeof arg === 'object' && arg?.title === 'taskList.bulk.refreshFailed.title',
    );
    expect(refreshWarning).toBeDefined();
    // The batch itself was committed: its selection is done.
    expect(useTaskSelectionStore.getState().selectedIds).toEqual([]);

    refreshWarning![0].actions[0].onClick();
    expect(refreshTaskList).toHaveBeenCalledTimes(2);
  });

  it('warns when the completion follow-ups failed after the batch committed', async () => {
    batchUpdate.mockResolvedValue({
      failed: [],
      followUpFailed: true,
      skipped: [],
      updated: ['a'],
    });
    useTaskSelectionStore.getState().prune(new Set(['a']));
    useTaskSelectionStore.getState().selectAll(['a']);
    const { result } = renderHook(() => useTaskBatchActions());

    await act(() => result.current.run({ kind: 'update', patch: { priority: 1 } }));

    expect(
      toastWarning.mock.calls.some(
        ([arg]) => typeof arg === 'object' && arg?.title === 'taskList.bulk.followUpFailed.title',
      ),
    ).toBe(true);
  });
});
