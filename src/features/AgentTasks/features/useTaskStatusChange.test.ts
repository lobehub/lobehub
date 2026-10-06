import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskStatusChange } from './useTaskStatusChange';

const mocks = vi.hoisted(() => ({
  createCascadeModal: vi.fn(),
  getSubtasks: vi.fn(),
  refreshTaskDetail: vi.fn(),
  refreshTaskList: vi.fn(),
  toastError: vi.fn(),
  updateStatusCascade: vi.fn(),
  updateTaskStatus: vi.fn(),
}));

vi.mock('@/services/task', () => ({
  taskService: {
    getSubtasks: mocks.getSubtasks,
    updateStatusCascade: mocks.updateStatusCascade,
  },
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (
    selector: (state: {
      internal_refreshTaskDetail: typeof mocks.refreshTaskDetail;
      refreshTaskList: typeof mocks.refreshTaskList;
      updateTaskStatus: typeof mocks.updateTaskStatus;
    }) => unknown,
  ) =>
    selector({
      internal_refreshTaskDetail: mocks.refreshTaskDetail,
      refreshTaskList: mocks.refreshTaskList,
      updateTaskStatus: mocks.updateTaskStatus,
    }),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: mocks.toastError },
}));

vi.mock('./TaskStatusCascadeModal', () => ({
  createTaskStatusCascadeModal: mocks.createCascadeModal,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('useTaskStatusChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshTaskDetail.mockResolvedValue(undefined);
    mocks.refreshTaskList.mockResolvedValue(undefined);
    mocks.updateStatusCascade.mockResolvedValue(undefined);
    mocks.updateTaskStatus.mockResolvedValue('T-1');
  });

  it('updates non-terminal statuses without inspecting subtasks', async () => {
    const { result } = renderHook(() => useTaskStatusChange());

    await expect(result.current('T-1', 'paused')).resolves.toBe(true);

    expect(mocks.getSubtasks).not.toHaveBeenCalled();
    expect(mocks.updateTaskStatus).toHaveBeenCalledWith('T-1', 'paused');
  });

  it('updates a terminal status directly when there are no open subtasks', async () => {
    mocks.getSubtasks.mockResolvedValue({
      data: [
        { identifier: 'T-2', status: 'completed' },
        { identifier: 'T-3', status: 'canceled' },
      ],
    });
    const { result } = renderHook(() => useTaskStatusChange());

    await expect(result.current('T-1', 'completed')).resolves.toBe(true);

    expect(mocks.createCascadeModal).not.toHaveBeenCalled();
    expect(mocks.updateTaskStatus).toHaveBeenCalledWith('T-1', 'completed');
  });

  it('updates every open subtask before the parent when the user chooses update all', async () => {
    mocks.getSubtasks.mockResolvedValue({
      data: [
        { identifier: 'T-2', name: 'Open', status: 'backlog' },
        { identifier: 'T-3', name: 'Already done', status: 'completed' },
        { identifier: 'T-4', name: 'Running', status: 'running' },
        { identifier: 'T-5', name: 'Failed', status: 'failed' },
      ],
    });
    mocks.createCascadeModal.mockImplementation(async ({ onApply }) => {
      await onApply(true);
      return true;
    });
    const { result } = renderHook(() => useTaskStatusChange());

    await expect(result.current('T-1', 'completed')).resolves.toBe(true);

    expect(mocks.createCascadeModal).toHaveBeenCalledWith(
      expect.objectContaining({
        subtasks: [
          expect.objectContaining({ identifier: 'T-2' }),
          expect.objectContaining({ identifier: 'T-4' }),
        ],
        targetStatus: 'completed',
      }),
    );
    expect(mocks.updateStatusCascade).toHaveBeenCalledWith('T-1', 'completed');
    expect(mocks.updateTaskStatus).not.toHaveBeenCalled();
    expect(mocks.refreshTaskDetail).toHaveBeenCalledWith('T-1');
    expect(mocks.refreshTaskList).toHaveBeenCalledTimes(1);
  });

  it('leaves subtasks unchanged when the user chooses parent only', async () => {
    mocks.getSubtasks.mockResolvedValue({
      data: [{ identifier: 'T-2', status: 'backlog' }],
    });
    mocks.createCascadeModal.mockImplementation(async ({ onApply }) => {
      await onApply(false);
      return true;
    });
    const { result } = renderHook(() => useTaskStatusChange());

    await result.current('T-1', 'canceled');

    expect(mocks.updateTaskStatus).toHaveBeenCalledTimes(1);
    expect(mocks.updateTaskStatus).toHaveBeenCalledWith('T-1', 'canceled');
  });

  it('does not update anything when the modal is dismissed', async () => {
    mocks.getSubtasks.mockResolvedValue({
      data: [{ identifier: 'T-2', status: 'backlog' }],
    });
    mocks.createCascadeModal.mockResolvedValue(false);
    const { result } = renderHook(() => useTaskStatusChange());

    await expect(result.current('T-1', 'completed')).resolves.toBe(false);

    expect(mocks.updateTaskStatus).not.toHaveBeenCalled();
  });
});
