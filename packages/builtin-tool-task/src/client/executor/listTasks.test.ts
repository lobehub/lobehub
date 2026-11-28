import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchTaskList: vi.fn() }));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  getActiveWorkspaceSlug: vi.fn(),
}));
vi.mock('@/business/client/hooks/useWorkspaceMembers', () => ({ getWorkspaceMembers: vi.fn() }));
vi.mock('@/store/user', () => ({ useUserStore: { getState: () => ({}) } }));
vi.mock('@/store/user/selectors', () => ({ userProfileSelectors: {} }));
vi.mock('@/store/chat', () => ({ getChatStoreState: vi.fn() }));
vi.mock('@/store/task', () => ({
  getTaskStoreState: () => ({ fetchTaskList: mocks.fetchTaskList }),
}));
vi.mock('@/store/task/slices/detail/reducer', () => ({ findSubtaskParentId: vi.fn() }));
vi.mock('@/services/task', () => ({ taskService: {} }));

const { taskExecutor } = await import('./index');

describe('TaskExecutor listTasks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.fetchTaskList.mockResolvedValue({ data: [], total: 0 });
  });

  it.each(['', '   '])(
    'rejects a blank parentIdentifier (%j) and tells the model to omit it',
    async (parentIdentifier) => {
      const result = await taskExecutor.listTasks({
        assigneeAgentId: 'agt-1',
        parentIdentifier,
        statuses: ['running'],
      });

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('ListTasksFailed');
      expect(result.content).toContain('omit parentIdentifier');
      expect(mocks.fetchTaskList).not.toHaveBeenCalled();
    },
  );

  it('lists subtasks of a real parent identifier', async () => {
    const result = await taskExecutor.listTasks({ parentIdentifier: 'T-1' });

    expect(result.success).toBe(true);
    expect(mocks.fetchTaskList).toHaveBeenCalledWith(
      expect.objectContaining({ parentIdentifier: 'T-1' }),
    );
  });
});
