import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  updateTaskModelConfig: vi.fn(),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  getActiveWorkspaceSlug: vi.fn(() => undefined),
}));
vi.mock('@/business/client/hooks/useWorkspaceMembers', () => ({
  getWorkspaceMembers: vi.fn(() => []),
}));
vi.mock('@/store/user', () => ({ useUserStore: { getState: () => ({}) } }));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { displayUserName: () => '', userId: () => undefined },
}));
vi.mock('@/store/chat', () => ({ getChatStoreState: vi.fn() }));
vi.mock('@/store/task', () => ({
  getTaskStoreState: () => ({
    createTask: mocks.createTask,
    updateTask: mocks.updateTask,
    updateTaskModelConfig: mocks.updateTaskModelConfig,
  }),
}));
vi.mock('@/store/task/slices/detail/reducer', () => ({
  findSubtaskParentId: vi.fn(() => undefined),
}));
vi.mock('@/services/task', () => ({
  taskService: { find: vi.fn(async () => ({ data: { id: 'task-1', identifier: 'T-1' } })) },
}));

const { taskExecutor } = await import('./index');

describe('TaskExecutor — task model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTask.mockResolvedValue({
      id: 'task-1',
      identifier: 'T-1',
      name: 'Run',
      priority: 0,
      status: 'backlog',
    });
    mocks.updateTask.mockResolvedValue(undefined);
    mocks.updateTaskModelConfig.mockResolvedValue(undefined);
  });

  describe('createTask', () => {
    it('writes an explicit model and provider into config', async () => {
      await taskExecutor.createTask(
        { instruction: 'Run', model: 'deepseek-chat', name: 'Run', provider: 'lobehub' },
        { agentId: 'agt-1' } as any,
      );

      expect(mocks.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ config: { model: 'deepseek-chat', provider: 'lobehub' } }),
      );
    });

    it('sends no config without a model, keeping the assignee snapshot path', async () => {
      await taskExecutor.createTask({ instruction: 'Run', name: 'Run' }, {
        agentId: 'agt-1',
      } as any);

      expect(mocks.createTask.mock.calls[0][0].config).toBeUndefined();
    });

    it('applies the model to each createTasks item independently', async () => {
      await taskExecutor.createTasks(
        {
          tasks: [
            { instruction: 'A', model: 'gpt-5', name: 'A' },
            { instruction: 'B', name: 'B' },
          ],
        },
        { agentId: 'agt-1' } as any,
      );

      expect(mocks.createTask.mock.calls[0][0].config).toEqual({ model: 'gpt-5' });
      expect(mocks.createTask.mock.calls[1][0].config).toBeUndefined();
    });
  });

  describe('editTask', () => {
    it('merges the model into config without touching other fields', async () => {
      const result = await taskExecutor.editTask({
        identifier: 'T-1',
        model: 'deepseek-chat',
        provider: 'lobehub',
      });

      expect(result.success).toBe(true);
      expect(mocks.updateTaskModelConfig).toHaveBeenCalledWith(
        'task-1',
        { model: 'deepseek-chat', provider: 'lobehub' },
        { rethrow: true },
      );
      expect(mocks.updateTask).not.toHaveBeenCalled();
      expect(result.content).toContain('model → lobehub/deepseek-chat');
    });

    it('clears model and provider for model: null', async () => {
      const result = await taskExecutor.editTask({ identifier: 'T-1', model: null });

      expect(mocks.updateTaskModelConfig).toHaveBeenCalledWith(
        'task-1',
        { model: null, provider: null },
        { rethrow: true },
      );
      expect(result.content).toContain('follows the assignee agent');
    });

    it('leaves the model alone when no model field is passed', async () => {
      await taskExecutor.editTask({ identifier: 'T-1', name: 'Renamed' });
      await taskExecutor.editTask({ identifier: 'T-1', model: '', name: 'Renamed', provider: '' });

      expect(mocks.updateTaskModelConfig).not.toHaveBeenCalled();
    });

    it('reports a model write that did not land as a failure', async () => {
      mocks.updateTaskModelConfig.mockRejectedValueOnce(new Error('network down'));

      const result = await taskExecutor.editTask({ identifier: 'T-1', model: 'gpt-5' });

      expect(result.success).toBe(false);
      expect(result.content).toContain('network down');
    });
  });
});
