import type { TaskItem } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { matchTaskRefs, parseTaskRef } from '@/database/models/task/refs';

import { createTaskRuntime } from './task';

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.lobehub.com' } }));
vi.mock('@/server/routers/lambda/task', () => ({ taskRouter: { createCaller: vi.fn() } }));
vi.mock('@/server/services/task', () => ({ TaskService: vi.fn() }));

const setup = () => {
  const rows = ['1', '2', '3'].map((n) => ({
    id: `task_${n}`,
    identifier: `T-${n}`,
    status: 'backlog',
  })) as TaskItem[];
  const resolveRefs = async (refs: string[]) => matchTaskRefs(refs.map(parseTaskRef), rows);
  const run = vi.fn().mockResolvedValue({ topicId: 'tpc_1', operationId: 'op_1' });
  const runtime = createTaskRuntime({
    taskId: 'task_1',
    taskModel: {
      resolveRefs,
      resolve: async (ref: string) => (await resolveRefs([ref])).byRef.get(ref) ?? null,
    } as never,
    taskCaller: { run } as never,
    taskService: {} as never,
    agentModel: {} as never,
  });
  return { run, runtime };
};

describe('task runtime canonical references', () => {
  it('resolves a run ref before calling the router and returns canonical state', async () => {
    const { run, runtime } = setup();
    const result = await runtime.runTask({
      identifier: 't-1',
      prompt: 'extra',
      continueTopicId: 'old',
    });
    expect(run).toHaveBeenCalledWith({ id: 'task_1', prompt: 'extra', continueTopicId: 'old' });
    expect(result).toMatchObject({ success: true, state: { taskId: 'task_1', identifier: 'T-1' } });
    expect(result.content).toContain('T-1 (id: task_1)');
  });
  it('uses the canonical task context when a ref is omitted', async () => {
    const { run, runtime } = setup();
    await runtime.runTask({});
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: 'task_1' }));
  });
  it('executes aliases once, reports original refs and preserves per-item failures', async () => {
    const { run, runtime } = setup();
    run
      .mockResolvedValueOnce({ topicId: 'first' })
      .mockRejectedValueOnce(new Error('Already running'));
    const result = await runtime.runTasks({ identifiers: [' T-1 ', 'task_1', 't-2', 'missing'] });
    expect(run).toHaveBeenCalledTimes(2);
    expect(result.state).toMatchObject({
      succeeded: 1,
      failed: 2,
      results: [
        { taskId: 'task_1', identifier: 'T-1', refs: [' T-1 ', 'task_1'], success: true },
        { taskId: 'task_2', identifier: 'T-2', refs: ['t-2'], success: false },
        { refs: ['missing'], success: false },
      ],
    });
  });
});
