import { normalizeListTasksParams, UNFINISHED_TASK_STATUSES } from '@lobechat/builtin-tool-task';
import { describe, expect, it, vi } from 'vitest';

import { createTaskRuntime } from '../task';

vi.mock('@/server/routers/lambda/task', () => ({
  taskRouter: { createCaller: () => ({}) },
}));

describe('createTaskRuntime', () => {
  describe('normalizeListTasksParams', () => {
    it('defaults to top-level unfinished tasks for the current agent', () => {
      const result = normalizeListTasksParams({}, { currentAgentId: 'agt-1' });

      expect(result.query).toMatchObject({
        assigneeAgentId: 'agt-1',
        parentTaskId: null,
        statuses: UNFINISHED_TASK_STATUSES,
      });
      expect(result.displayFilters).toMatchObject({
        assigneeAgentId: 'agt-1',
        isDefaultScope: true,
        isForCurrentAgent: true,
      });
    });

    it('can default to top-level unfinished tasks across all agents', () => {
      const result = normalizeListTasksParams(
        {},
        { currentAgentId: 'agt-1', defaultScope: 'allAgents' },
      );

      expect(result.query).toMatchObject({
        assigneeAgentId: undefined,
        parentTaskId: null,
        statuses: UNFINISHED_TASK_STATUSES,
      });
      expect(result.displayFilters).toMatchObject({
        isDefaultScope: true,
        isForAllAgents: true,
        isForCurrentAgent: false,
      });
    });

    it('does not apply implicit assignee when explicit filters are present', () => {
      const result = normalizeListTasksParams(
        { statuses: ['completed'] },
        { currentAgentId: 'agt-1' },
      );

      expect(result.query).toMatchObject({
        assigneeAgentId: undefined,
        parentTaskId: undefined,
        statuses: ['completed'],
      });
      expect(result.displayFilters).toMatchObject({
        isDefaultScope: false,
        isForAllAgents: false,
        isForCurrentAgent: false,
      });
    });
  });

  describe('createTask', () => {
    const fakeTask = {
      id: 'task-1',
      identifier: 'T-1',
      name: 'Test',
      priority: 0,
      status: 'backlog',
    };

    const makeDeps = () => {
      const agentModel = {
        existsById: vi.fn().mockResolvedValue(true),
      };
      const taskModel = {
        create: vi.fn().mockResolvedValue(fakeTask),
        resolve: vi.fn(),
      };
      const taskService = {} as any;
      const taskCaller = {} as any;
      return { agentModel, taskCaller, taskModel, taskService };
    };

    it('passes createdByAgentId when invoked by an agent (activity should attribute the agent)', async () => {
      const deps = makeDeps();

      const runtime = createTaskRuntime({
        agentModel: deps.agentModel as any,
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
        agentModel: deps.agentModel as any,
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

    it('does not default assigneeAgentId in task manager scope', async () => {
      const deps = makeDeps();

      const runtime = createTaskRuntime({
        agentModel: deps.agentModel as any,
        agentId: 'agt-xyz',
        scope: 'task',
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
          createdByAgentId: 'agt-xyz',
        }),
      );
    });

    it('uses explicit assigneeAgentId in task manager scope', async () => {
      const deps = makeDeps();

      const runtime = createTaskRuntime({
        agentModel: deps.agentModel as any,
        agentId: 'agt-manager',
        scope: 'task',
        taskCaller: deps.taskCaller,
        taskModel: deps.taskModel as any,
        taskService: deps.taskService,
      });

      await runtime.createTask({
        assigneeAgentId: 'agt-worker',
        instruction: 'Do something',
        name: 'Test',
      });

      expect(deps.taskModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assigneeAgentId: 'agt-worker',
          createdByAgentId: 'agt-manager',
        }),
      );
      expect(deps.agentModel.existsById).toHaveBeenCalledWith('agt-worker');
    });

    it('rejects explicit assigneeAgentId that is not owned by the current user', async () => {
      const deps = makeDeps();
      deps.agentModel.existsById.mockResolvedValue(false);

      const runtime = createTaskRuntime({
        agentModel: deps.agentModel as any,
        agentId: 'agt-manager',
        scope: 'task',
        taskCaller: deps.taskCaller,
        taskModel: deps.taskModel as any,
        taskService: deps.taskService,
      });

      const result = await runtime.createTask({
        assigneeAgentId: 'agt-other-user',
        instruction: 'Do something',
        name: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.content).toBe('Assignee agent not found: agt-other-user');
      expect(deps.taskModel.create).not.toHaveBeenCalled();
    });

    it('resolves and uses parentTaskId when parentIdentifier is provided', async () => {
      const deps = makeDeps();
      deps.taskModel.resolve = vi.fn().mockResolvedValue({ id: 'parent-id', identifier: 'T-99' });

      const runtime = createTaskRuntime({
        agentModel: deps.agentModel as any,
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
        agentModel: deps.agentModel as any,
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

  describe('editTask', () => {
    const makeDeps = () => {
      const agentModel = {
        existsById: vi.fn().mockResolvedValue(true),
      };
      const taskModel = {
        resolve: vi.fn().mockResolvedValue({ id: 'task-1', identifier: 'T-1' }),
        update: vi.fn().mockResolvedValue({}),
      };
      const taskService = {} as any;
      const taskCaller = {} as any;
      return { agentModel, taskCaller, taskModel, taskService };
    };

    it('rejects explicit assigneeAgentId that is not owned by the current user', async () => {
      const deps = makeDeps();
      deps.agentModel.existsById.mockResolvedValue(false);

      const runtime = createTaskRuntime({
        agentModel: deps.agentModel as any,
        agentId: 'agt-manager',
        taskCaller: deps.taskCaller,
        taskModel: deps.taskModel as any,
        taskService: deps.taskService,
      });

      const result = await runtime.editTask({
        assigneeAgentId: 'agt-other-user',
        identifier: 'T-1',
      });

      expect(result.success).toBe(false);
      expect(result.content).toBe('Assignee agent not found: agt-other-user');
      expect(deps.taskModel.update).not.toHaveBeenCalled();
    });

    it('allows clearing assigneeAgentId without ownership lookup', async () => {
      const deps = makeDeps();

      const runtime = createTaskRuntime({
        agentModel: deps.agentModel as any,
        agentId: 'agt-manager',
        taskCaller: deps.taskCaller,
        taskModel: deps.taskModel as any,
        taskService: deps.taskService,
      });

      const result = await runtime.editTask({
        assigneeAgentId: null,
        identifier: 'T-1',
      });

      expect(result.success).toBe(true);
      expect(deps.agentModel.existsById).not.toHaveBeenCalled();
      expect(deps.taskModel.update).toHaveBeenCalledWith('task-1', { assigneeAgentId: null });
    });
  });

  describe('listTasks', () => {
    it('uses all-agent default scope in task manager context', async () => {
      const taskCaller = { list: vi.fn().mockResolvedValue({ data: [] }) };
      const runtime = createTaskRuntime({
        agentModel: { existsById: vi.fn() } as any,
        agentId: 'agt-xyz',
        scope: 'task',
        taskCaller: taskCaller as any,
        taskModel: {} as any,
        taskService: {} as any,
      });

      await runtime.listTasks({});

      expect(taskCaller.list).toHaveBeenCalledWith(
        expect.objectContaining({
          assigneeAgentId: undefined,
          parentTaskId: null,
        }),
      );
    });
  });
});
