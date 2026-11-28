import { normalizeListTasksParams, UNFINISHED_TASK_STATUSES } from '@lobechat/builtin-tool-task';
import { describe, expect, it, vi } from 'vitest';

import { createTaskRuntime } from '../task';

vi.mock('@/business/server/task/notifyTaskAssigned', () => ({ notifyTaskAssigned: vi.fn() }));
vi.mock('@/server/routers/lambda/task', () => ({ taskRouter: { createCaller: vi.fn() } }));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.lobehub.com' } }));
vi.mock('@/server/services/task', () => ({ TaskService: vi.fn() }));

describe('createTaskRuntime listTasks', () => {
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

  describe('listTasks', () => {
    it('uses all-agent default scope in task manager context', async () => {
      const taskCaller = { list: vi.fn().mockResolvedValue({ data: [] }) };
      const runtime = createTaskRuntime({
        agentModel: { existsById: vi.fn() } as any,
        agentId: 'agt-xyz',
        scope: 'task',
        taskCaller: taskCaller as any,
        taskModel: {
          resolve: vi.fn().mockResolvedValue({ id: 'task-1', identifier: 'T-1' }),
        } as any,
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

    it.each(['', '   '])(
      'rejects a blank parentIdentifier (%j) and tells the model to omit it',
      async (parentIdentifier) => {
        const taskCaller = { list: vi.fn().mockResolvedValue({ data: [] }) };
        const runtime = createTaskRuntime({
          agentModel: { existsById: vi.fn() } as any,
          agentId: 'agt-xyz',
          taskCaller: taskCaller as any,
          taskModel: {} as any,
          taskService: {} as any,
        });

        const result = await runtime.listTasks({
          assigneeAgentId: 'agt-1',
          parentIdentifier,
          statuses: ['running'],
        });

        expect(result.success).toBe(false);
        expect(result.content).toContain('omit parentIdentifier');
        expect(taskCaller.list).not.toHaveBeenCalled();
      },
    );
  });
});
