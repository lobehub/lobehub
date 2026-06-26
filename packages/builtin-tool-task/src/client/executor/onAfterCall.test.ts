import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskApiName } from '../../types';

const mocks = vi.hoisted(() => ({
  getChatStoreState: vi.fn(),
  getTaskStoreState: vi.fn(),
  openTaskDetail: vi.fn(),
}));

vi.mock('@/store/chat', () => ({
  getChatStoreState: mocks.getChatStoreState,
}));

vi.mock('@/store/task', () => ({
  getTaskStoreState: mocks.getTaskStoreState,
}));

vi.mock('@/store/task/slices/detail/reducer', () => ({
  findSubtaskParentId: vi.fn(() => undefined),
}));

vi.mock('@/services/task', () => ({
  taskService: {},
}));

// Imported after mocks so the executor module resolves the stubbed stores.
const { taskExecutor } = await import('./index');

describe('TaskExecutor.onAfterCall — portal auto-open', () => {
  beforeEach(() => {
    mocks.openTaskDetail.mockClear();
    mocks.getChatStoreState.mockReturnValue({ openTaskDetail: mocks.openTaskDetail });
    mocks.getTaskStoreState.mockReturnValue({
      activeTaskId: undefined,
      internal_refreshTaskDetail: vi.fn().mockResolvedValue(undefined),
      refreshTaskList: vi.fn().mockResolvedValue(undefined),
      taskDetailMap: {},
    });
  });

  it('opens the task detail portal after a successful createTask', async () => {
    await taskExecutor.onAfterCall({
      apiName: TaskApiName.createTask,
      params: {},
      result: { content: '', state: { identifier: 'task-123' }, success: true },
    } as any);

    expect(mocks.openTaskDetail).toHaveBeenCalledWith('task-123');
  });

  it('does not open the portal for non-createTask APIs', async () => {
    await taskExecutor.onAfterCall({
      apiName: TaskApiName.editTask,
      params: { identifier: 'task-1' },
      result: { content: '', state: { identifier: 'task-1' }, success: true },
    } as any);

    expect(mocks.openTaskDetail).not.toHaveBeenCalled();
  });

  it('does not open the portal when createTask failed', async () => {
    await taskExecutor.onAfterCall({
      apiName: TaskApiName.createTask,
      params: {},
      result: { content: '', success: false },
    } as any);

    expect(mocks.openTaskDetail).not.toHaveBeenCalled();
  });
});
