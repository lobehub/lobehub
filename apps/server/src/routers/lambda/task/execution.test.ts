// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTaskExecutionRouter } from './execution';

const mocks = vi.hoisted(() => ({ runTask: vi.fn() }));

vi.mock('@/server/services/taskRunner', () => ({
  TaskRunnerService: vi.fn().mockImplementation(function () {
    return { runTask: mocks.runTask };
  }),
}));
vi.mock('@/server/services/taskLifecycle/failStuckTasks', () => ({ failStuckTasks: vi.fn() }));
vi.mock('./procedures', async () => {
  const { z } = await import('zod');
  const { publicProcedure } = await import('@/libs/trpc/lambda');
  return {
    idInput: z.object({ id: z.string() }),
    taskProcedure: publicProcedure,
    taskProcedureWrite: publicProcedure,
  };
});

describe('task.run model override', () => {
  const caller = createTaskExecutionRouter().createCaller({
    taskModel: { resolve: async (id: string) => ({ id }) },
    userId: 'user-1',
  } as never);

  beforeEach(() => {
    mocks.runTask.mockReset();
    mocks.runTask.mockResolvedValue({ success: true });
  });

  it('forwards a trimmed model and provider to the runner', async () => {
    await caller.run({ id: 'task_1', model: ' fixed-model ', provider: 'working' });

    expect(mocks.runTask).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'fixed-model', provider: 'working', taskId: 'task_1' }),
    );
  });

  it('treats blank values as not passed', async () => {
    await caller.run({ id: 'task_1', model: '  ', provider: '' });

    expect(mocks.runTask).toHaveBeenCalledWith(
      expect.objectContaining({ model: undefined, provider: undefined }),
    );
  });

  it('refuses a provider without a model before starting a run', async () => {
    await expect(caller.run({ id: 'task_1', provider: 'working' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    expect(mocks.runTask).not.toHaveBeenCalled();
  });
});
