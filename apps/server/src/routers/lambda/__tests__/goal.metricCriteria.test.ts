// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(() => (opts: any) => opts.next({ ctx: opts.ctx })),
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { authedProcedure } = await import('@/libs/trpc/lambda');
  return { wsCompatProcedure: authedProcedure };
});

const mockCreate = vi.fn();
const mockSetMetricCriteria = vi.fn();
const mockFindById = vi.fn();

vi.mock('@/server/services/goal', () => ({
  GoalService: vi.fn(() => ({
    create: mockCreate,
    setMetricCriteria: mockSetMetricCriteria,
  })),
}));

vi.mock('@/database/models/goal', () => ({
  GoalModel: vi.fn(() => ({ findById: mockFindById })),
}));

vi.mock('@/server/services/goal/scheduler', () => ({
  scheduleGoalAdvance: vi.fn(),
}));

const { goalRouter } = await import('../goal');

describe('goalRouter numeric acceptance', () => {
  const ctx: any = { serverDB: {}, userId: 'user-1', workspaceId: null };
  const caller = goalRouter.createCaller(ctx);

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ goal: { id: 'goal_1' } });
    mockFindById.mockResolvedValue({ id: 'goal_1', userId: 'user-1' });
    mockSetMetricCriteria.mockResolvedValue({ goal: { id: 'goal_1' } });
  });

  it('carries measured clauses through the create contract', async () => {
    // Zod strips unknown keys, so a clause absent from the schema would reach
    // the service as `undefined` and leave the gate unreachable in production
    // while the service-level tests still passed.
    await caller.create({
      config: { acceptance: { metrics: [{ key: 'followers', target: 1_000_000 }] } },
      title: 'Grow the account',
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { acceptance: { metrics: [{ key: 'followers', target: 1_000_000 }] } },
      }),
    );
  });

  it('declares clauses after creation', async () => {
    await caller.setMetricCriteria({
      id: 'goal_1',
      metrics: [{ key: 'churn', op: 'lte', target: 5 }],
    });

    expect(mockSetMetricCriteria).toHaveBeenCalledWith('goal_1', [
      { key: 'churn', op: 'lte', target: 5 },
    ]);
  });

  it('rejects a comparison the evaluator does not implement', async () => {
    await expect(
      caller.setMetricCriteria({
        id: 'goal_1',
        metrics: [{ key: 'churn', op: 'approx' as never, target: 5 }],
      }),
    ).rejects.toThrow();
    expect(mockSetMetricCriteria).not.toHaveBeenCalled();
  });
});
