// @vitest-environment node
import { GOAL_TITLE_MAX_LENGTH } from '@lobechat/const/goal';
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

const mockFindById = vi.fn();
const mockUpdateTitle = vi.fn();
vi.mock('@/database/models/goal', () => ({
  GoalModel: vi.fn(function () {
    return { findById: mockFindById };
  }),
}));
vi.mock('@/server/services/goal', () => ({
  GoalService: vi.fn(function () {
    return { updateTitle: mockUpdateTitle };
  }),
}));
vi.mock('@/server/services/goal/subscriptions', () => ({ GoalSubscriptionService: vi.fn() }));
vi.mock('@/server/services/goal/scheduler', () => ({ scheduleGoalAdvance: vi.fn() }));

const { configurationRouter } = await import('./configuration');

describe('goal configurationRouter.updateTitle', () => {
  const caller = (ctx: { workspaceId?: string | null; workspaceRole?: string } = {}) =>
    configurationRouter.createCaller({ serverDB: {}, userId: 'user-1', ...ctx } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockResolvedValue({ id: 'goal_1', userId: 'user-1' });
    mockUpdateTitle.mockImplementation(async (id: string, title: string) => ({ id, title }));
  });

  it('saves the trimmed title', async () => {
    const result = await caller().updateTitle({ id: 'goal_1', title: '  Desk pet TTS  ' });

    expect(mockUpdateTitle).toHaveBeenCalledWith('goal_1', 'Desk pet TTS');
    expect(result).toEqual({ data: { id: 'goal_1', title: 'Desk pet TTS' }, success: true });
  });

  it('rejects a blank title', async () => {
    await expect(caller().updateTitle({ id: 'goal_1', title: '   ' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(mockUpdateTitle).not.toHaveBeenCalled();
  });

  it('rejects a title over the length cap', async () => {
    await expect(
      caller().updateTitle({ id: 'goal_1', title: 'a'.repeat(GOAL_TITLE_MAX_LENGTH + 1) }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockUpdateTitle).not.toHaveBeenCalled();
  });

  it('reports a goal outside the caller scope as not found', async () => {
    mockFindById.mockResolvedValue(undefined);

    await expect(caller().updateTitle({ id: 'goal_x', title: 'New' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(mockUpdateTitle).not.toHaveBeenCalled();
  });

  it('lets only the creator or an owner rename a workspace goal', async () => {
    mockFindById.mockResolvedValue({ id: 'goal_1', userId: 'user-2' });

    await expect(
      caller({ workspaceId: 'ws-1', workspaceRole: 'member' }).updateTitle({
        id: 'goal_1',
        title: 'New',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockUpdateTitle).not.toHaveBeenCalled();

    await caller({ workspaceId: 'ws-1', workspaceRole: 'owner' }).updateTitle({
      id: 'goal_1',
      title: 'New',
    });
    expect(mockUpdateTitle).toHaveBeenCalledWith('goal_1', 'New');
  });
});
