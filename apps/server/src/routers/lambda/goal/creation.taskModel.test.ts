// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(function () {
    return (opts: any) => opts.next({ ctx: opts.ctx });
  }),
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async (importOriginal) => {
  const { authedProcedure } = await import('@/libs/trpc/lambda');
  return { ...(await importOriginal<object>()), wsCompatProcedure: authedProcedure };
});

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  scheduleGoalAdvance: vi.fn(),
  setTaskModel: vi.fn(),
}));

vi.mock('@/server/services/goal', () => ({
  GoalService: vi.fn(function () {
    return { create: mocks.create, delete: mocks.delete, setTaskModel: mocks.setTaskModel };
  }),
}));
vi.mock('@/server/services/goal/scheduler', () => ({
  scheduleGoalAdvance: mocks.scheduleGoalAdvance,
}));
vi.mock('@/database/models/goal', () => ({ GoalModel: vi.fn() }));

const { creationRouter } = await import('./creation');

const modelConfig = { model: 'deepseek-flash', provider: 'lobehub' };
const caller = () =>
  creationRouter.createCaller({ serverDB: {}, userId: 'user-1', workspaceId: 'ws-1' } as any);

describe('goal.create with a task model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ goal: { config: {}, id: 'goal_1' }, nodes: [] });
    mocks.delete.mockResolvedValue(undefined);
    mocks.scheduleGoalAdvance.mockResolvedValue(undefined);
    mocks.setTaskModel.mockResolvedValue({
      config: { taskModel: 'deepseek-flash', taskProvider: 'lobehub' },
      id: 'goal_1',
    });
  });

  it('applies the model before the first coordinator step is scheduled', async () => {
    const result = await caller().create({ taskModelConfig: modelConfig, title: 'Goal' });

    expect(mocks.setTaskModel).toHaveBeenCalledWith('goal_1', modelConfig);
    expect(mocks.setTaskModel.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.scheduleGoalAdvance.mock.invocationCallOrder[0],
    );
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('taskModelConfig');
    expect(result?.data.goal.config?.taskModel).toBe('deepseek-flash');
  });

  it('removes the goal and schedules nothing when the model is refused', async () => {
    mocks.setTaskModel.mockRejectedValue(new Error('This model is not available'));

    await expect(
      caller().create({ taskModelConfig: modelConfig, title: 'Goal' }),
    ).rejects.toThrow();

    expect(mocks.delete).toHaveBeenCalledWith('goal_1');
    expect(mocks.scheduleGoalAdvance).not.toHaveBeenCalled();
  });

  it('leaves a goal without a task model on the existing path', async () => {
    await caller().create({ title: 'Goal' });

    expect(mocks.setTaskModel).not.toHaveBeenCalled();
    expect(mocks.scheduleGoalAdvance).toHaveBeenCalledOnce();
  });
});
