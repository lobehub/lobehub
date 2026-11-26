import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskSelectionStore } from './store';
import { resetUndoStack } from './undo/stack';
import { useTaskBatchUndo } from './undo/useTaskBatchUndo';
import { useTaskBatchActions } from './useTaskBatchActions';

const batchUpdate = vi.fn();
const batchDelete = vi.fn();
const batchRevert = vi.fn();
const batchRestoreDeleted = vi.fn();
const refreshTaskList = vi.fn(async () => {});
const toastWarning = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const overlay = { commit: vi.fn(), rollback: vi.fn() };
const beginOptimistic = vi.fn((..._args: unknown[]) => overlay);

vi.mock('@/services/task', () => ({
  taskService: {
    batchDelete: (...args: unknown[]) => batchDelete(...args),
    batchRestoreDeleted: (...args: unknown[]) => batchRestoreDeleted(...args),
    batchRevert: (...args: unknown[]) => batchRevert(...args),
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
  batchRevert.mockReset();
  batchRestoreDeleted.mockReset();
  resetUndoStack();
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

  it('runs the prepare step after the overlay and before the batch request', async () => {
    const order: string[] = [];
    beginOptimistic.mockImplementationOnce(() => {
      order.push('overlay');
      return overlay;
    });
    batchUpdate.mockImplementation(async () => {
      order.push('batch');
      return { failed: [], skipped: [], updated: ['a', 'b'] };
    });
    const prepare = vi.fn(async (ids: string[]) => {
      order.push(`prepare:${ids.join(',')}`);
    });
    useTaskSelectionStore.getState().prune(new Set(['a', 'b']));
    useTaskSelectionStore.getState().selectAll(['a', 'b']);
    const { result } = renderHook(() => useTaskBatchActions());

    await act(() =>
      result.current.run(
        { kind: 'update', patch: { assigneeAgentId: 'agt_private' } },
        { prepare },
      ),
    );

    expect(order).toEqual(['overlay', 'prepare:a,b', 'batch']);
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

  describe('undo', () => {
    const undoAction = () => {
      const [options] = toastSuccess.mock.calls.at(-1)!;
      return (options as { actions?: { label: string; onClick: () => void }[] }).actions?.[0];
    };

    it('offers an undo that writes back what the batch replaced', async () => {
      const reverts = [{ after: { priority: 1 }, before: { priority: 3 }, id: 'a' }];
      batchUpdate.mockResolvedValue({ failed: [], reverts, skipped: [], updated: ['a'] });
      batchRevert.mockResolvedValue({ failed: [], skipped: [], updated: ['a'] });
      useTaskSelectionStore.getState().selectAll(['a']);
      const { result } = renderHook(() => useTaskBatchActions());

      await act(() => result.current.run({ kind: 'update', patch: { priority: 1 } }));
      const action = undoAction();
      expect(action?.label).toBe('taskList.bulk.undo.action');

      await act(async () => {
        action!.onClick();
      });
      await act(async () => {});

      expect(batchRevert).toHaveBeenCalledWith(reverts);
      // Optimistic like the batch: one overlay for the undo, committed on success.
      expect(beginOptimistic).toHaveBeenCalledTimes(2);
      expect(overlay.commit).toHaveBeenCalledTimes(2);
      expect(toastSuccess).toHaveBeenLastCalledWith('taskList.bulk.undo.done');
    });

    it('undoes a delete through the recycle bin, once', async () => {
      batchDelete.mockResolvedValue({ failed: [], skipped: [], updated: ['a', 'b'] });
      batchRestoreDeleted.mockResolvedValue({ failed: [], skipped: [], updated: ['a', 'b'] });
      useTaskSelectionStore.getState().selectAll(['a', 'b']);
      const { result } = renderHook(() => useTaskBatchActions());
      const { result: undo } = renderHook(() => useTaskBatchUndo());

      await act(() => result.current.run({ kind: 'delete' }));
      // ⌘Z and the toast button reach the same entry: only one restore runs.
      await act(async () => {
        expect(undo.current.undoLast()).toBe(true);
        undoAction()!.onClick();
      });
      await act(async () => {});

      expect(batchRestoreDeleted).toHaveBeenCalledTimes(1);
      expect(batchRestoreDeleted).toHaveBeenCalledWith(['a', 'b']);
      expect(undo.current.undoLast()).toBe(false);
    });

    it('says how many tasks someone changed again since the batch', async () => {
      const reverts = [
        { after: { status: 'completed' }, before: { status: 'backlog' }, id: 'a' },
        { after: { status: 'completed' }, before: { status: 'backlog' }, id: 'b' },
      ];
      batchUpdate.mockResolvedValue({ failed: [], reverts, skipped: [], updated: ['a', 'b'] });
      batchRevert.mockResolvedValue({
        failed: [],
        skipped: [{ id: 'b', reason: 'conflict' }],
        updated: ['a'],
      });
      useTaskSelectionStore.getState().selectAll(['a', 'b']);
      const { result } = renderHook(() => useTaskBatchActions());

      await act(() => result.current.run({ kind: 'update', patch: { priority: 1 } }));
      await act(async () => undoAction()!.onClick());
      await act(async () => {});

      expect(toastWarning).toHaveBeenLastCalledWith(
        'taskList.bulk.undo.done · taskList.bulk.undo.conflict',
      );
    });
  });
});
