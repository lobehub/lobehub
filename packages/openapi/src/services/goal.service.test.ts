// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { GoalRestService } from './goal.service';

const {
  deleteGoalMock,
  findByIdMock,
  hasAnyPermissionMock,
  restartGoalMock,
  scheduleGoalAdvanceMock,
} = vi.hoisted(() => ({
  deleteGoalMock: vi.fn(),
  findByIdMock: vi.fn(),
  hasAnyPermissionMock: vi.fn(),
  restartGoalMock: vi.fn(),
  scheduleGoalAdvanceMock: vi.fn(),
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
    delete = deleteGoalMock;
    restart = restartGoalMock;
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
