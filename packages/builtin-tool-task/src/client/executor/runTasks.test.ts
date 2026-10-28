import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ find: vi.fn(), run: vi.fn(), refreshTaskList: vi.fn() }));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  getActiveWorkspaceSlug: vi.fn(),
}));
vi.mock('@/business/client/hooks/useWorkspaceMembers', () => ({ getWorkspaceMembers: vi.fn() }));
vi.mock('@/store/user', () => ({ useUserStore: { getState: () => ({}) } }));
vi.mock('@/store/user/selectors', () => ({ userProfileSelectors: {} }));
vi.mock('@/store/chat', () => ({ getChatStoreState: vi.fn() }));
vi.mock('@/store/task', () => ({
  getTaskStoreState: () => ({ refreshTaskList: mocks.refreshTaskList }),
}));
vi.mock('@/store/task/slices/detail/reducer', () => ({ findSubtaskParentId: vi.fn() }));
vi.mock('@/services/task', () => ({ taskService: { find: mocks.find, run: mocks.run } }));

const { taskExecutor } = await import('./index');

describe('TaskExecutor batch references', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.find.mockResolvedValue({ data: { id: 'task_1', identifier: 'T-1' } });
    mocks.run.mockResolvedValue({ topicId: 'topic_1' });
  });
  it('retains original refs and executes mixed aliases only once', async () => {
    const result = await taskExecutor.runTasks({ identifiers: [' T-1 ', 'task_1'] });
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith('task_1');
    expect(result.state).toMatchObject({
      results: [{ taskId: 'task_1', identifier: 'T-1', refs: [' T-1 ', 'task_1'] }],
    });
  });
  it('rejects the entire ambiguous batch before executing any task', async () => {
    mocks.find
      .mockResolvedValueOnce({ data: { id: 'task_1', identifier: 'T-1' } })
      .mockRejectedValueOnce(
        Object.assign(new Error('Ambiguous task reference: T-2'), {
          data: { code: 'BAD_REQUEST' },
        }),
      );
    const result = await taskExecutor.runTasks({ identifiers: ['T-1', 'T-2'] });
    expect(result.success).toBe(false);
    expect(result.content).toContain('Ambiguous task reference');
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('includes lookup and kickoff failures in the model-visible content', async () => {
    mocks.find.mockRejectedValueOnce(new Error('Task not found: T-9'));
    mocks.run.mockRejectedValueOnce(new Error('Already running'));
    const result = await taskExecutor.runTasks({ identifiers: ['T-9', 'task_1'] });
    expect(result.success).toBe(false);
    expect(result.content).toContain('T-9');
    expect(result.content).toContain('Task not found: T-9');
    expect(result.content).toContain('T-1 (id: task_1)');
    expect(result.content).toContain('Already running');
  });
});
