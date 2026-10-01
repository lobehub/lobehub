// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { GoalRestService } from './goal.service';

const {
  deleteGoalMock,
  findByIdMock,
  goalServiceCtorMock,
  graphMock,
  hasAnyPermissionMock,
  restartGoalMock,
  scheduleGoalAdvanceMock,
  setBudgetMock,
  updateRequirementMock,
} = vi.hoisted(() => ({
  deleteGoalMock: vi.fn(),
  findByIdMock: vi.fn(),
  goalServiceCtorMock: vi.fn(),
  graphMock: vi.fn(),
  hasAnyPermissionMock: vi.fn(),
  restartGoalMock: vi.fn(),
  scheduleGoalAdvanceMock: vi.fn(),
  setBudgetMock: vi.fn(),
  updateRequirementMock: vi.fn(),
}));

vi.mock('@/const/rbac', () => ({ ALL_SCOPE: 'all' }));
vi.mock('@lobechat/database', () => ({
  buildWorkspacePayload: vi.fn(),
  buildWorkspaceWhere: vi.fn(),
}));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = hasAnyPermissionMock;
  },
}));
vi.mock('@/database/schemas', () => ({
  agents: {},
  aiModels: {},
  aiProviders: {},
  files: {},
  knowledgeBases: {},
  messages: {},
  sessions: {},
  topics: {},
}));
vi.mock('@/utils/rbac', () => ({ getScopePermissions: () => [] }));
vi.mock('@/database/models/goal', () => ({
  GoalModel: class {
    findById = findByIdMock;
  },
}));
vi.mock('@/server/services/goal', () => ({
  GoalService: class {
    constructor(...args: unknown[]) {
      // Recorded so a test can prove the writes went through the transaction
      // handle rather than the shared pool.
      goalServiceCtorMock(...args);
    }

    delete = deleteGoalMock;
    graph = graphMock;
    restart = restartGoalMock;
    setBudget = setBudgetMock;
    updateRequirement = updateRequirementMock;
  },
}));
vi.mock('@/server/services/goal/advanceGoal', () => ({ advanceGoal: vi.fn() }));
vi.mock('@/server/services/goal/scheduler', () => ({
  scheduleGoalAdvance: scheduleGoalAdvanceMock,
}));

const CALLER = 'me';
const WORKSPACE = 'ws-1';

/**
 * `assertRowManageable` mirrors the tRPC rule: a workspace write permission says
 * a member may change *a* goal, not *whose*. These cases pin the creator gate on
 * the two destructive REST actions, which the reviewer flagged.
 */
describe('GoalRestService creator gate on restart/delete', () => {
  const service = (workspaceId?: string) =>
    new GoalRestService({} as LobeChatDatabase, CALLER, workspaceId);

  beforeEach(() => {
    vi.clearAllMocks();
    // The caller holds only the `:owner` scope, not workspace-wide `:all`.
    hasAnyPermissionMock.mockResolvedValue(false);
    findByIdMock.mockResolvedValue({ id: 'goal-1', userId: 'other-member' });
  });

  it.each(['restartGoal', 'deleteGoal'] as const)(
    'refuses %s on a goal created by another workspace member',
    async (method) => {
      const svc = service(WORKSPACE);
      const call =
        method === 'restartGoal' ? svc.restartGoal('goal-1', {}) : svc.deleteGoal('goal-1');

      await expect(call).rejects.toThrow(/Only the creator or a workspace owner/);
      expect(restartGoalMock).not.toHaveBeenCalled();
      expect(deleteGoalMock).not.toHaveBeenCalled();
    },
  );

  it('lets a workspace-wide (:all scope) caller manage another member goal', async () => {
    hasAnyPermissionMock.mockResolvedValue(true);
    restartGoalMock.mockResolvedValue({ restartedTaskIds: [] });

    await expect(service(WORKSPACE).restartGoal('goal-1', {})).resolves.toEqual({
      restartedTaskIds: [],
    });
    expect(restartGoalMock).toHaveBeenCalledWith('goal-1', { agentId: undefined });
  });

  it('lets the creator restart and delete their own goal', async () => {
    findByIdMock.mockResolvedValue({ id: 'goal-1', userId: CALLER });
    restartGoalMock.mockResolvedValue({ restartedTaskIds: ['task-1'] });

    const svc = service(WORKSPACE);
    await expect(svc.restartGoal('goal-1', {})).resolves.toEqual({ restartedTaskIds: ['task-1'] });
    await expect(svc.deleteGoal('goal-1')).resolves.toBeUndefined();
    expect(deleteGoalMock).toHaveBeenCalledWith('goal-1');
  });

  it('keeps personal scope a hard boundary for another user goal', async () => {
    await expect(service().deleteGoal('goal-1')).rejects.toThrow('Goal not found');
    expect(deleteGoalMock).not.toHaveBeenCalled();
  });
});

/**
 * A combined patch writes the requirement and the budget, and the budget can be
 * refused (e.g. `maxManagerTurns` on a goal with no main Agent). Both writes
 * have to share one transaction, or the caller sees a 400 while half the patch
 * has already been persisted.
 */
describe('GoalRestService combined patch atomicity', () => {
  const TX = { tx: 'tx' };

  const serviceOverTransaction = () =>
    new GoalRestService(
      {
        transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(TX),
      } as unknown as LobeChatDatabase,
      CALLER,
      WORKSPACE,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    hasAnyPermissionMock.mockResolvedValue(false);
    findByIdMock.mockResolvedValue({ id: 'goal-1', userId: CALLER });
    graphMock.mockResolvedValue({ goal: { id: 'goal-1' } });
    updateRequirementMock.mockResolvedValue({ id: 'goal-1' });
    setBudgetMock.mockResolvedValue({ id: 'goal-1' });
  });

  it('applies both writes through one transaction before enqueueing the advance', async () => {
    await serviceOverTransaction().updateGoal('goal-1', {
      budget: { maxManagerTurns: 2 },
      requirement: 'new',
    });

    // Both writes went through the transaction handle rather than the pool, so
    // a failure anywhere in the callback rolls them back together.
    expect(goalServiceCtorMock).toHaveBeenCalledWith(TX, CALLER, WORKSPACE);
    expect(updateRequirementMock).toHaveBeenCalledWith('goal-1', 'new');
    expect(setBudgetMock).toHaveBeenCalledWith('goal-1', { maxManagerTurns: 2 });
    expect(scheduleGoalAdvanceMock).toHaveBeenCalledTimes(1);
  });

  it('enqueues nothing and reads back no graph when the budget write is refused', async () => {
    setBudgetMock.mockRejectedValue(
      new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Only a Goal with a main Agent has a turn budget',
      }),
    );

    await expect(
      serviceOverTransaction().updateGoal('goal-1', {
        budget: { maxManagerTurns: 2 },
        requirement: 'new',
      }),
    ).rejects.toThrow('Only a Goal with a main Agent has a turn budget');

    expect(goalServiceCtorMock).toHaveBeenCalledWith(TX, CALLER, WORKSPACE);
    expect(scheduleGoalAdvanceMock).not.toHaveBeenCalled();
    expect(graphMock).not.toHaveBeenCalled();
  });

  it('still enqueues an advance for a budget-only patch', async () => {
    await serviceOverTransaction().updateGoal('goal-1', { budget: { maxTotalCost: 25 } });

    expect(updateRequirementMock).not.toHaveBeenCalled();
    expect(setBudgetMock).toHaveBeenCalledWith('goal-1', { maxTotalCost: 25 });
    expect(scheduleGoalAdvanceMock).toHaveBeenCalledTimes(1);
  });
});
