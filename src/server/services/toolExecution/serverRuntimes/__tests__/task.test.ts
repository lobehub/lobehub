import { normalizeListTasksParams, UNFINISHED_TASK_STATUSES } from '@lobechat/builtin-tool-task';
import { describe, expect, it, vi } from 'vitest';

import { createTaskRuntime } from '../task';

vi.mock('@/server/routers/lambda/task', () => ({
  taskRouter: { createCaller: () => ({}) },
}));

// TaskService's transitive deps (taskReview → ModelRuntime) call getLLMConfig
// at module load, which fails in unit-test env. The runtime is passed a
// taskService instance per test, so a stubbed class is all we need here.
vi.mock('@/server/services/task', () => ({
  TaskService: vi.fn(),
}));

describe('createTaskRuntime', () => {
  describe('task comments', () => {
    it('adds a comment to the current task with agent attribution', async () => {
      const taskCaller = {
        addComment: vi.fn().mockResolvedValue({ data: { id: 'comment-1' } }),
      };
      const runtime = createTaskRuntime({
        agentModel: { existsById: vi.fn() } as any,
        agentId: 'agt-manager',
        taskCaller: taskCaller as any,
        taskId: 'T-1',
        taskModel: {} as any,
        taskService: {} as any,
      });

      const result = await runtime.addTaskComment({ content: 'Keep the original parent.' });

      expect(result.success).toBe(true);
      expect(taskCaller.addComment).toHaveBeenCalledWith({
        authorAgentId: 'agt-manager',
        content: 'Keep the original parent.',
        id: 'T-1',
      });
      expect(result.content).toBe('Comment added to task T-1.');
    });

    it('updates and deletes comments by commentId', async () => {
      const taskCaller = {
        deleteComment: vi.fn().mockResolvedValue({ success: true }),
        updateComment: vi.fn().mockResolvedValue({ success: true }),
      };
      const runtime = createTaskRuntime({
        agentModel: { existsById: vi.fn() } as any,
        taskCaller: taskCaller as any,
        taskModel: {} as any,
        taskService: {} as any,
      });

      await runtime.updateTaskComment({ commentId: 'comment-1', content: 'Updated' });
      await runtime.deleteTaskComment({ commentId: 'comment-1' });

      expect(taskCaller.updateComment).toHaveBeenCalledWith({
        commentId: 'comment-1',
        content: 'Updated',
      });
      expect(taskCaller.deleteComment).toHaveBeenCalledWith({ commentId: 'comment-1' });
    });
  });

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
        resolve: vi.fn(),
      };
      const taskService = {
        createTask: vi.fn().mockResolvedValue(fakeTask),
      };
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
        taskService: deps.taskService as any,
      });

      const result = await runtime.createTask({
        instruction: 'Do something',
        name: 'Test',
      });

      expect(result.success).toBe(true);
      expect(deps.taskService.createTask).toHaveBeenCalledWith(
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
        taskService: deps.taskService as any,
      });

      await runtime.createTask({
        instruction: 'Do something',
        name: 'Test',
      });

      expect(deps.taskService.createTask).toHaveBeenCalledWith(
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
        taskService: deps.taskService as any,
      });

      await runtime.createTask({
        instruction: 'Do something',
        name: 'Test',
      });

      expect(deps.taskService.createTask).toHaveBeenCalledWith(
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
        taskService: deps.taskService as any,
      });

      await runtime.createTask({
        assigneeAgentId: 'agt-worker',
        instruction: 'Do something',
        name: 'Test',
      });

      expect(deps.taskService.createTask).toHaveBeenCalledWith(
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
        taskService: deps.taskService as any,
      });

      const result = await runtime.createTask({
        assigneeAgentId: 'agt-other-user',
        instruction: 'Do something',
        name: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.content).toBe('Assignee agent not found: agt-other-user');
      expect(deps.taskService.createTask).not.toHaveBeenCalled();
    });

    it('resolves and uses parentTaskId when parentIdentifier is provided', async () => {
      const deps = makeDeps();
      deps.taskModel.resolve = vi.fn().mockResolvedValue({ id: 'parent-id', identifier: 'T-99' });

      const runtime = createTaskRuntime({
        agentModel: deps.agentModel as any,
        agentId: 'agt-xyz',
        taskCaller: deps.taskCaller,
        taskModel: deps.taskModel as any,
        taskService: deps.taskService as any,
      });

      await runtime.createTask({
        instruction: 'Sub',
        name: 'Sub',
        parentIdentifier: 'T-99',
      });

      expect(deps.taskService.createTask).toHaveBeenCalledWith(
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
        taskService: deps.taskService as any,
      });

      const result = await runtime.createTask({
        instruction: 'Sub',
        name: 'Sub',
        parentIdentifier: 'T-404',
      });

      expect(result.success).toBe(false);
      expect(deps.taskService.createTask).not.toHaveBeenCalled();
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
      const taskCaller = { update: vi.fn().mockResolvedValue({}) } as any;
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
        taskService: deps.taskService as any,
      });

      const result = await runtime.editTask({
        assigneeAgentId: 'agt-other-user',
        identifier: 'T-1',
      });

      expect(result.success).toBe(false);
      expect(result.content).toBe('Assignee agent not found: agt-other-user');
      expect(deps.taskModel.update).not.toHaveBeenCalled();
      expect(deps.taskCaller.update).not.toHaveBeenCalled();
    });

    it('allows clearing assigneeAgentId without ownership lookup', async () => {
      const deps = makeDeps();

      const runtime = createTaskRuntime({
        agentModel: deps.agentModel as any,
        agentId: 'agt-manager',
        taskCaller: deps.taskCaller,
        taskModel: deps.taskModel as any,
        taskService: deps.taskService as any,
      });

      const result = await runtime.editTask({
        assigneeAgentId: null,
        identifier: 'T-1',
      });

      expect(result.success).toBe(true);
      expect(deps.agentModel.existsById).not.toHaveBeenCalled();
      expect(deps.taskCaller.update).toHaveBeenCalledWith({
        assigneeAgentId: null,
        id: 'task-1',
      });
      expect(deps.taskModel.update).not.toHaveBeenCalled();
    });

    it('delegates parentIdentifier to router update for resolution and safety validation', async () => {
      const deps = makeDeps();

      const runtime = createTaskRuntime({
        agentModel: deps.agentModel as any,
        agentId: 'agt-manager',
        taskCaller: deps.taskCaller,
        taskModel: deps.taskModel as any,
        taskService: deps.taskService as any,
      });

      const result = await runtime.editTask({
        identifier: 'T-1',
        parentIdentifier: 'T-43',
      });

      expect(result.success).toBe(true);
      expect(deps.taskCaller.update).toHaveBeenCalledWith({ id: 'task-1', parentTaskId: 'T-43' });
      expect(deps.taskModel.update).not.toHaveBeenCalled();
      expect(result.content).toContain('parent → T-43');
    });

    it('passes null parentIdentifier through to move a task to the top level', async () => {
      const deps = makeDeps();

      const runtime = createTaskRuntime({
        agentModel: deps.agentModel as any,
        agentId: 'agt-manager',
        taskCaller: deps.taskCaller,
        taskModel: deps.taskModel as any,
        taskService: deps.taskService as any,
      });

      const result = await runtime.editTask({
        identifier: 'T-1',
        parentIdentifier: null,
      });

      expect(result.success).toBe(true);
      expect(deps.taskCaller.update).toHaveBeenCalledWith({ id: 'task-1', parentTaskId: null });
      expect(deps.taskModel.update).not.toHaveBeenCalled();
      expect(result.content).toContain('parent cleared');
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

  describe('createTasks (batch)', () => {
    const makeDeps = () => {
      const agentModel = { existsById: vi.fn().mockResolvedValue(true) };
      const taskModel = {
        resolve: vi.fn(),
      };
      const taskService = {
        createTask: vi.fn().mockImplementation(async ({ name }) => ({
          id: `db-${name}`,
          identifier: `T-${name}`,
          name,
          priority: 0,
          status: 'backlog',
        })),
      };
      return {
        agentModel,
        taskCaller: {} as any,
        taskModel,
        taskService,
      };
    };

    it('creates each task and aggregates a header line + per-item summary', async () => {
      const deps = makeDeps();
      const runtime = createTaskRuntime({
        agentModel: deps.agentModel as any,
        agentId: 'agt-x',
        taskCaller: deps.taskCaller,
        taskModel: deps.taskModel as any,
        taskService: deps.taskService as any,
      });

      const result = await runtime.createTasks({
        tasks: [
          { instruction: 'a', name: 'A' },
          { instruction: 'b', name: 'B' },
        ],
      });

      expect(result.success).toBe(true);
      expect(deps.taskService.createTask).toHaveBeenCalledTimes(2);
      expect(result.content).toContain('Created 2 tasks');
      expect(result.content).toContain('T-A');
      expect(result.content).toContain('T-B');
    });

    it('continues past per-item failures and reports them in the summary', async () => {
      const deps = makeDeps();
      // make the second create throw
      deps.taskService.createTask
        .mockResolvedValueOnce({
          id: 'db-A',
          identifier: 'T-A',
          name: 'A',
          priority: 0,
          status: 'backlog',
        })
        .mockRejectedValueOnce(new Error('boom'));

      const runtime = createTaskRuntime({
        agentModel: deps.agentModel as any,
        agentId: 'agt-x',
        taskCaller: deps.taskCaller,
        taskModel: deps.taskModel as any,
        taskService: deps.taskService as any,
      });

      const result = await runtime.createTasks({
        tasks: [
          { instruction: 'a', name: 'A' },
          { instruction: 'b', name: 'B' },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('Created 1/2 tasks (1 failed)');
      expect(result.content).toContain('boom');
    });

    it('returns failure when no tasks are provided', async () => {
      const deps = makeDeps();
      const runtime = createTaskRuntime({
        agentModel: deps.agentModel as any,
        taskCaller: deps.taskCaller,
        taskModel: deps.taskModel as any,
        taskService: deps.taskService as any,
      });

      const result = await runtime.createTasks({ tasks: [] });

      expect(result.success).toBe(false);
      expect(deps.taskService.createTask).not.toHaveBeenCalled();
    });
  });

  describe('runTask / runTasks', () => {
    it('forwards identifier + prompt + continueTopicId to taskCaller.run', async () => {
      const taskCaller = {
        run: vi.fn().mockResolvedValue({ operationId: 'op_1', topicId: 'tpc_1' }),
      };
      const runtime = createTaskRuntime({
        agentModel: { existsById: vi.fn() } as any,
        taskCaller: taskCaller as any,
        taskModel: {} as any,
        taskService: {} as any,
      });

      const result = await runtime.runTask({
        continueTopicId: 'tpc_existing',
        identifier: 'T-1',
        prompt: 'extra',
      });

      expect(result.success).toBe(true);
      expect(taskCaller.run).toHaveBeenCalledWith({
        continueTopicId: 'tpc_existing',
        id: 'T-1',
        prompt: 'extra',
      });
      expect(result.content).toContain('Task T-1 started');
      expect(result.content).toContain('Topic: tpc_1');
    });

    it('falls back to current task context when identifier omitted', async () => {
      const taskCaller = {
        run: vi.fn().mockResolvedValue({ operationId: 'op', topicId: 'tpc' }),
      };
      const runtime = createTaskRuntime({
        agentModel: { existsById: vi.fn() } as any,
        taskCaller: taskCaller as any,
        taskId: 'T-current',
        taskModel: {} as any,
        taskService: {} as any,
      });

      await runtime.runTask({});

      expect(taskCaller.run).toHaveBeenCalledWith(expect.objectContaining({ id: 'T-current' }));
    });

    it('refuses to run when neither identifier nor task context is available', async () => {
      const taskCaller = { run: vi.fn() };
      const runtime = createTaskRuntime({
        agentModel: { existsById: vi.fn() } as any,
        taskCaller: taskCaller as any,
        taskModel: {} as any,
        taskService: {} as any,
      });

      const result = await runtime.runTask({});

      expect(result.success).toBe(false);
      expect(taskCaller.run).not.toHaveBeenCalled();
    });

    it('runs identifiers sequentially and surfaces per-item failures without aborting', async () => {
      const taskCaller = {
        run: vi
          .fn()
          .mockResolvedValueOnce({ topicId: 'tpc_a' })
          .mockRejectedValueOnce(new Error('Task already has a running topic'))
          .mockResolvedValueOnce({ topicId: 'tpc_c' }),
      };
      const runtime = createTaskRuntime({
        agentModel: { existsById: vi.fn() } as any,
        taskCaller: taskCaller as any,
        taskModel: {} as any,
        taskService: {} as any,
      });

      const result = await runtime.runTasks({ identifiers: ['T-A', 'T-B', 'T-C'] });

      expect(taskCaller.run).toHaveBeenCalledTimes(3);
      expect(result.success).toBe(false);
      expect(result.content).toContain('Started 2/3 tasks (1 failed)');
      expect(result.content).toContain('T-B — failed: Task already has a running topic');
    });
  });
});
