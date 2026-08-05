import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskApiName } from '../../types';

const mocks = vi.hoisted(() => ({
  getChatStoreState: vi.fn(),
  getTaskStoreState: vi.fn(),
  internalRefreshTaskDetail: vi.fn(),
  openTaskDetail: vi.fn(),
  refreshConversation: vi.fn(),
  refreshTaskList: vi.fn(),
  refreshVersions: vi.fn(),
  registerTask: vi.fn(),
  updateVerifyConfig: vi.fn(),
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
  taskService: {
    updateVerifyConfig: mocks.updateVerifyConfig,
  },
}));

vi.mock('@/services/work', () => ({
  workService: {
    refreshConversation: mocks.refreshConversation,
    refreshVersions: mocks.refreshVersions,
    registerTask: mocks.registerTask,
  },
}));

// Imported after mocks so the executor module resolves the stubbed stores.
const { taskExecutor } = await import('./index');

describe('TaskExecutor.onAfterCall — portal auto-open', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.internalRefreshTaskDetail.mockResolvedValue(undefined);
    mocks.refreshConversation.mockResolvedValue(undefined);
    mocks.refreshTaskList.mockResolvedValue(undefined);
    mocks.refreshVersions.mockResolvedValue(undefined);
    mocks.registerTask.mockResolvedValue({ id: 'work-1' });
    mocks.updateVerifyConfig.mockResolvedValue(undefined);
    mocks.getChatStoreState.mockReturnValue({ openTaskDetail: mocks.openTaskDetail });
    mocks.getTaskStoreState.mockReturnValue({
      activeTaskId: undefined,
      internal_refreshTaskDetail: mocks.internalRefreshTaskDetail,
      refreshTaskList: mocks.refreshTaskList,
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

  // Note: Work registration is no longer done inside the executor. It now runs
  // at the tool-execution dispatch layer (`invokeExecutor`), driven by the
  // manifest `work` config — covered by the dispatch-layer + shared-extractor
  // tests instead.
  it('applies verify config and refreshes the task detail', async () => {
    const result = await taskExecutor.setTaskVerify(
      {
        enabled: true,
        identifier: 'TASK-1',
        requirement: 'Ship tested output',
      },
      { agentId: 'agent-1' } as any,
    );

    expect(result.success).toBe(true);
    expect(mocks.updateVerifyConfig).toHaveBeenCalledWith({
      id: 'TASK-1',
      verify: {
        enabled: true,
        requirement: 'Ship tested output',
      },
    });
    expect(mocks.internalRefreshTaskDetail).toHaveBeenCalledWith('TASK-1');
    // The executor itself no longer registers Work or touches the work caches.
    expect(mocks.registerTask).not.toHaveBeenCalled();
    expect(mocks.refreshVersions).not.toHaveBeenCalled();
  });
});
