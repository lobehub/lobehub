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

// Router contract tests do not launch an Agent runtime.
vi.mock('@/server/services/aiAgent', () => ({ AiAgentService: vi.fn() }));
vi.mock('@/server/services/goal', () => ({ GoalService: vi.fn(function () {}) }));

const mockFindById = vi.fn();
vi.mock('@/database/models/goal', () => ({
  GoalModel: vi.fn(function () {
    return { findById: mockFindById };
  }),
}));

const mockStart = vi.fn();
vi.mock('@/server/services/goal/start', () => ({
  GoalStartService: vi.fn(function () {
    return { start: mockStart };
  }),
}));

vi.mock('@/server/services/goal/scheduler', () => ({ scheduleGoalAdvance: vi.fn() }));

const { goalRouter } = await import('../goal');

describe('goalRouter start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockResolvedValue({ id: 'goal_1', status: 'draft', userId: 'creator' });
    mockStart.mockResolvedValue({ id: 'goal_1', status: 'running' });
  });

  /**
   * Regression: the goal row is visible workspace-wide, so without the row
   * check any member could launch — and, with a rollout, fold away the seed
   * nodes of — another member's draft.
   */
  it("refuses a workspace member starting another member's draft", async () => {
    const caller = goalRouter.createCaller({
      serverDB: {},
      userId: 'other-member',
      workspaceId: 'ws_1',
      workspaceRole: 'member',
    } as any);

    await expect(caller.start({ id: 'goal_1' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('lets the creator or a workspace owner start it', async () => {
    for (const ctx of [
      { userId: 'creator', workspaceRole: 'member' },
      { userId: 'someone-else', workspaceRole: 'owner' },
    ]) {
      await goalRouter
        .createCaller({ serverDB: {}, workspaceId: 'ws_1', ...ctx } as any)
        .start({ id: 'goal_1' });
    }
    expect(mockStart).toHaveBeenCalledTimes(2);
  });
});
