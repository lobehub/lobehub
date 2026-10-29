// @vitest-environment node
import { TRPCError } from '@trpc/server';
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

vi.mock('@/server/services/goal', () => ({ GoalService: vi.fn() }));
vi.mock('@/server/services/goal/subscriptions', () => ({ GoalSubscriptionService: vi.fn() }));
vi.mock('@/database/models/goal', () => ({ GoalModel: vi.fn() }));

const mockHasPermission = vi.fn();
vi.mock('@/server/services/workspacePermission', () => ({
  hasWorkspaceScopedPermission: (...args: unknown[]) => mockHasPermission(...args),
}));

const mockStorageCheck = vi.fn();
vi.mock('@/business/server/lambda-routers/file', () => ({
  businessFileTransferStorageCheck: (...args: unknown[]) => mockStorageCheck(...args),
}));

const mockCopy = vi.fn();
const mockFixtureResources = vi.fn();
const copyScopes: Array<string | undefined> = [];
vi.mock('@/server/services/goal/copy', () => ({
  GoalCopyService: vi.fn(function (_db: unknown, _userId: string, workspaceId?: string) {
    copyScopes.push(workspaceId);
    return { copyToWorkspace: mockCopy, fixtureResources: mockFixtureResources };
  }),
}));

const { transferRouter } = await import('./transfer');

describe('goal transferRouter.copyGoalToWorkspace', () => {
  const caller = (workspaceId: string | null) =>
    transferRouter.createCaller({ serverDB: {}, userId: 'user-1', workspaceId } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    copyScopes.length = 0;
    mockCopy.mockResolvedValue({ goalId: 'goal_copy' });
    mockFixtureResources.mockResolvedValue({ documentIds: [], files: [] });
  });

  const checkedActions = () => mockHasPermission.mock.calls.map(([params]) => params.action);

  it('copies from the current scope once the target workspace grants write access', async () => {
    mockHasPermission.mockResolvedValue(true);

    const result = await caller('ws-source').copyGoalToWorkspace({
      id: 'goal_1',
      targetWorkspaceId: 'ws-target',
    });

    expect(mockHasPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AGENT_UPDATE',
        userId: 'user-1',
        workspaceId: 'ws-target',
      }),
    );
    expect(copyScopes).toEqual(['ws-source']);
    expect(mockCopy).toHaveBeenCalledWith('goal_1', 'ws-target');
    expect(result).toEqual({ goalId: 'goal_copy' });
  });

  it('refuses a target workspace the caller cannot write to', async () => {
    mockHasPermission.mockResolvedValue(false);

    await expect(
      caller(null).copyGoalToWorkspace({ id: 'goal_1', targetWorkspaceId: 'ws-target' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('also needs document and file rights on the target when fixtures are copied', async () => {
    mockHasPermission.mockResolvedValue(true);
    mockFixtureResources.mockResolvedValue({
      documentIds: ['docs_1'],
      files: [
        { id: 'file_1', size: 300 },
        { id: 'file_2', size: 200 },
      ],
    });

    await caller('ws-source').copyGoalToWorkspace({ id: 'goal_1', targetWorkspaceId: 'ws-target' });

    expect(checkedActions()).toEqual(['AGENT_UPDATE', 'DOCUMENT_CREATE', 'FILE_UPLOAD']);
    expect(mockStorageCheck).toHaveBeenCalledWith({
      additionalSize: 500,
      targetUserId: 'user-1',
      targetWorkspaceId: 'ws-target',
    });
    expect(mockCopy).toHaveBeenCalledWith('goal_1', 'ws-target');
  });

  it('refuses fixture files when the target role cannot upload files', async () => {
    mockHasPermission.mockImplementation(async ({ action }) => action !== 'FILE_UPLOAD');
    mockFixtureResources.mockResolvedValue({ documentIds: [], files: [{ id: 'file_1', size: 1 }] });

    await expect(
      caller('ws-source').copyGoalToWorkspace({ id: 'goal_1', targetWorkspaceId: 'ws-target' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockStorageCheck).not.toHaveBeenCalled();
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('stops before writing when fixture files exceed the target storage', async () => {
    mockFixtureResources.mockResolvedValue({ documentIds: [], files: [{ id: 'file_1', size: 9 }] });
    mockStorageCheck.mockRejectedValue(new TRPCError({ code: 'FORBIDDEN', message: 'quota' }));

    await expect(
      caller('ws-source').copyGoalToWorkspace({ id: 'goal_1', targetWorkspaceId: null }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockStorageCheck).toHaveBeenCalledWith(
      expect.objectContaining({ additionalSize: 9, targetWorkspaceId: null }),
    );
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('copies into personal without a workspace permission check', async () => {
    await caller('ws-source').copyGoalToWorkspace({ id: 'goal_1', targetWorkspaceId: null });

    expect(mockHasPermission).not.toHaveBeenCalled();
    expect(mockCopy).toHaveBeenCalledWith('goal_1', null);
  });
});
