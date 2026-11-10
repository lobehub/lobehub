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

vi.mock('@/server/services/aiAgent', () => ({ AiAgentService: vi.fn() }));

const mockBindTopic = vi.fn();
const mockFindById = vi.fn();

vi.mock('@/server/services/goal', () => ({
  GoalService: vi.fn(function () {
    return { bindTopic: mockBindTopic };
  }),
}));

vi.mock('@/database/models/goal', () => ({
  GoalModel: vi.fn(function () {
    return { findById: mockFindById };
  }),
}));

const mockScheduleGoalAdvance = vi.fn();
vi.mock('@/server/services/goal/scheduler', () => ({
  scheduleGoalAdvance: mockScheduleGoalAdvance,
}));

const { goalRouter } = await import('../goal');

describe('goalRouter.bindTopic', () => {
  const ctx: any = { serverDB: {}, userId: 'user-1', workspaceId: null };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockResolvedValue({ id: 'goal_1', userId: 'user-1' });
    mockBindTopic.mockResolvedValue({
      graph: { goal: { id: 'goal_1', subjectId: 'tpc_1', subjectType: 'topic' } },
      previousSubject: { id: 'tpc_0', type: 'topic' },
      reassignedTaskIds: ['task_1'],
      topicId: 'tpc_1',
      turnToken: 'turn_1',
    });
  });

  it('binds from the run, wakes the coordinator and returns the planning token', async () => {
    const result = await goalRouter
      .createCaller(ctx)
      .bindTopic({ force: true, id: 'goal_1', operationId: 'op_1' });

    expect(mockBindTopic).toHaveBeenCalledWith('goal_1', 'op_1', {
      force: true,
      goalOnly: undefined,
      localRun: undefined,
    });
    expect(mockScheduleGoalAdvance).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 'goal_1', userId: 'user-1' }),
    );
    expect(result).toMatchObject({
      message: 'Goal bound to topic tpc_1 (moved from topic tpc_0); 1 task(s) reassigned',
      turnToken: 'turn_1',
    });
  });

  it('passes a local run only when it names both its topic and agent', async () => {
    const caller = goalRouter.createCaller(ctx);

    await caller.bindTopic({ agentId: 'agent_1', id: 'goal_1', operationId: 'op_1' });
    expect(mockBindTopic).toHaveBeenLastCalledWith(
      'goal_1',
      'op_1',
      expect.objectContaining({ localRun: undefined }),
    );

    await caller.bindTopic({
      agentId: 'agent_1',
      id: 'goal_1',
      operationId: 'op_1',
      topicId: 'tpc_1',
    });
    expect(mockBindTopic).toHaveBeenLastCalledWith(
      'goal_1',
      'op_1',
      expect.objectContaining({ localRun: { agentId: 'agent_1', topicId: 'tpc_1' } }),
    );
  });

  it("refuses a workspace member binding a colleague's goal", async () => {
    mockFindById.mockResolvedValue({ id: 'goal_1', userId: 'colleague' });

    await expect(
      goalRouter
        .createCaller({ ...ctx, workspaceId: 'ws-1', workspaceRole: 'member' })
        .bindTopic({ id: 'goal_1', operationId: 'op_1' }),
    ).rejects.toThrow(/Only the creator or a workspace owner/);
    expect(mockBindTopic).not.toHaveBeenCalled();
    expect(mockScheduleGoalAdvance).not.toHaveBeenCalled();
  });

  it('reports a missing goal as not found', async () => {
    mockFindById.mockResolvedValue(undefined);

    await expect(
      goalRouter.createCaller(ctx).bindTopic({ id: 'goal_x', operationId: 'op_1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
