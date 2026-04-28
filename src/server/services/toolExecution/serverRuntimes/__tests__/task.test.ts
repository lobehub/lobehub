import { describe, expect, it, vi } from 'vitest';

import { createTaskRuntime } from '../task';

vi.mock('@/server/routers/lambda/task', () => ({
  taskRouter: { createCaller: () => ({}) },
}));

describe('createTaskRuntime', () => {
  describe('createTask', () => {
    const fakeTask = {
      id: 'task-1',
      identifier: 'T-1',
      name: 'Test',
      priority: 0,
      status: 'backlog',
    };

    const makeDeps = () => {
      const taskModel = {
        create: vi.fn().mockResolvedValue(fakeTask),
        resolve: vi.fn(),
      };
      const taskService = {} as any;
      const taskCaller = {} as any;
      return { taskCaller, taskModel, taskService };
    };

    it('passes createdByAgentId when invoked by an agent (activity should attribute the agent)', async () => {
      const deps = makeDeps();

      const runtime = createTaskRuntime({
        agentId: 'agt-xyz',
        taskCaller: deps.taskCaller,
        taskModel: deps.taskModel as any,
        taskService: deps.taskService,
      });

      const result = await runtime.createTask({
        instruction: 'Do something',
        name: 'Test',
      });

      expect(result.success).toBe(true);
      expect(deps.taskModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assigneeAgentId: 'agt-xyz',
          createdByAgentId: 'agt-xyz',
        }),
      );
    });

    it('leaves createdByAgentId undefined when no agentId in context', async () => {
      const deps = makeDeps();

      const runtime = createTaskRuntime({
        taskCaller: deps.taskCaller,
        taskModel: deps.taskModel as any,
        taskService: deps.taskService,
      });

      await runtime.createTask({
        instruction: 'Do something',
        name: 'Test',
      });

      expect(deps.taskModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assigneeAgentId: undefined,
          createdByAgentId: undefined,
        }),
      );
    });

    it('resolves and uses parentTaskId when parentIdentifier is provided', async () => {
      const deps = makeDeps();
      deps.taskModel.resolve = vi.fn().mockResolvedValue({ id: 'parent-id', identifier: 'T-99' });

      const runtime = createTaskRuntime({
        agentId: 'agt-xyz',
        taskCaller: deps.taskCaller,
        taskModel: deps.taskModel as any,
        taskService: deps.taskService,
      });

      await runtime.createTask({
        instruction: 'Sub',
        name: 'Sub',
        parentIdentifier: 'T-99',
      });

      expect(deps.taskModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          createdByAgentId: 'agt-xyz',
          parentTaskId: 'parent-id',
        }),
      );
    });

    it('returns failure without creating when parent cannot be resolved', async () => {
      const deps = makeDeps();
      deps.taskModel.resolve = vi.fn().mockResolvedValue(null);

      const runtime = createTaskRuntime({
        agentId: 'agt-xyz',
        taskCaller: deps.taskCaller,
        taskModel: deps.taskModel as any,
        taskService: deps.taskService,
      });

      const result = await runtime.createTask({
        instruction: 'Sub',
        name: 'Sub',
        parentIdentifier: 'T-404',
      });

      expect(result.success).toBe(false);
      expect(deps.taskModel.create).not.toHaveBeenCalled();
    });
  });
});
