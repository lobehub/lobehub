/**
 * @vitest-environment happy-dom
 */
import type { IEditor } from '@lobehub/editor';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskStore } from '@/store/task';
import { useTaskStore } from '@/store/task';

import { useTaskInstructionAutosave } from './useTaskInstructionAutosave';

describe('useTaskInstructionAutosave', () => {
  const editor = {
    getDocument: vi.fn((type: string) =>
      type === 'json' ? { root: { children: [{ text: 'Local edit' }] } } : 'Local edit',
    ),
  } as unknown as IEditor;
  const onEdit = vi.fn();
  const updateTask = vi.fn().mockResolvedValue(undefined) as TaskStore['updateTask'];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useTaskStore.setState({ taskInstructionRevisionMap: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a pending autosave when the external revision stays stable', async () => {
    const { result, rerender } = renderHook(
      ({ contentRevision }) =>
        useTaskInstructionAutosave({
          contentRevision,
          editable: true,
          editor,
          onEdit,
          taskId: 'T-1',
          updateTask,
        }),
      { initialProps: { contentRevision: 0 } },
    );

    act(() => result.current());
    rerender({ contentRevision: 0 });
    await act(async () => vi.advanceTimersByTimeAsync(300));

    expect(updateTask).toHaveBeenCalledWith(
      'T-1',
      {
        editorData: { root: { children: [{ text: 'Local edit' }] } },
        instruction: 'Local edit',
      },
      { source: 'editor' },
    );
  });

  it('cancels a pending autosave when an external instruction revision arrives', async () => {
    const { result, rerender } = renderHook(
      ({ contentRevision }) =>
        useTaskInstructionAutosave({
          contentRevision,
          editable: true,
          editor,
          onEdit,
          taskId: 'T-1',
          updateTask,
        }),
      { initialProps: { contentRevision: 0 } },
    );

    act(() => result.current());
    rerender({ contentRevision: 1 });
    await act(async () => vi.advanceTimersByTimeAsync(300));

    expect(updateTask).not.toHaveBeenCalled();
  });

  it('drops a queued autosave when the Store revision changes before React rerenders', async () => {
    const { result } = renderHook(() =>
      useTaskInstructionAutosave({
        contentRevision: 0,
        editable: true,
        editor,
        onEdit,
        taskId: 'T-1',
        updateTask,
      }),
    );

    act(() => result.current());
    act(() => {
      useTaskStore.setState({ taskInstructionRevisionMap: { 'T-1': 1 } });
    });
    await act(async () => vi.advanceTimersByTimeAsync(300));

    expect(editor.getDocument).not.toHaveBeenCalled();
    expect(updateTask).not.toHaveBeenCalled();
  });
});
