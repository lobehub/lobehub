// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { GoalAdvancedRestService } from './goal-advanced.service';

const { closeMock, createCallerMock, findByIdMock, retireNodesMock } = vi.hoisted(() => ({
  closeMock: vi.fn(),
  createCallerMock: vi.fn(),
  findByIdMock: vi.fn(),
  retireNodesMock: vi.fn(),
}));

vi.mock('@/const/rbac', () => ({ ALL_SCOPE: 'all' }));
vi.mock('@lobechat/database', () => ({
  buildWorkspacePayload: vi.fn(),
  buildWorkspaceWhere: vi.fn(),
}));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = vi.fn();
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
    graph = vi.fn();
  },
}));
vi.mock('@/server/services/goal/advanceGoal', () => ({ advanceGoal: vi.fn() }));
vi.mock('@/server/services/goal/scheduler', () => ({ scheduleGoalAdvance: vi.fn() }));
vi.mock('@/server/routers/lambda/goal', () => ({
  goalRouter: { createCaller: createCallerMock },
}));

const CALLER = 'me';
const WORKSPACE = 'ws-1';

/**
 * The `goal` procedures gate destructive edits with `assertWorkspaceRowManageable`,
 * which only lets a caller manage another member's goal when
 * `ctx.workspaceRole === 'owner'`. The REST layer already resolved that role in
 * the workspace middleware, so these cases pin that it survives into the
 * server-side caller context — dropping it 403s a workspace owner on their own
 * workspace's goals (reviewer P2 on the goal control endpoints).
 */
describe('GoalAdvancedRestService workspace role', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByIdMock.mockResolvedValue({ id: 'goal-1', userId: 'other-member' });
    closeMock.mockResolvedValue({ data: { id: 'goal-1', status: 'achieved' } });
    retireNodesMock.mockResolvedValue({ data: { id: 'goal-1' } });
    createCallerMock.mockReturnValue({ close: closeMock, retireNodes: retireNodesMock });
  });

  it('hands the resolved workspace role to the goal procedures', async () => {
    const service = new GoalAdvancedRestService({} as LobeChatDatabase, CALLER, WORKSPACE, 'owner');

    await service.closeGoal('goal-1', 'achieved');

    expect(createCallerMock).toHaveBeenCalledWith({
      userId: CALLER,
      workspaceId: WORKSPACE,
      workspaceRole: 'owner',
    });
    expect(closeMock).toHaveBeenCalledWith({ id: 'goal-1', status: 'achieved' });
  });

  it('passes no role in personal scope, where the model already scopes by owner', async () => {
    findByIdMock.mockResolvedValue({ id: 'goal-1', userId: CALLER });
    const service = new GoalAdvancedRestService({} as LobeChatDatabase, CALLER);

    await service.closeGoal('goal-1', 'achieved');

    expect(createCallerMock).toHaveBeenCalledWith({
      userId: CALLER,
      workspaceId: undefined,
      workspaceRole: undefined,
    });
    expect(closeMock).toHaveBeenCalledWith({ id: 'goal-1', status: 'achieved' });
  });
});
