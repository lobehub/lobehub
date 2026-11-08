// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceRole } from '@/business/server/trpc-middlewares/workspaceAuth';

import { deviceRouter } from '../device';

const mocks = vi.hoisted(() => ({
  findByDeviceId: vi.fn(),
  findWorkspaceDeviceById: vi.fn(),
  runGitPullRequestAction: vi.fn(),
}));

// OSS ships a no-op role guard. Model the cloud contract to exercise the
// router's write gate, including fail-closed scoped requests and personal mode.
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { trpc } = await import('@/libs/trpc/lambda/init');
  const ranks = { admin: 2, member: 1, owner: 3, viewer: 0 };

  return {
    ...actual,
    requireWorkspaceRoleWhenScoped: (minRole: WorkspaceRole) =>
      trpc.middleware(async ({ ctx, next }) => {
        const { workspaceId, workspaceRole } = ctx as {
          workspaceId?: string;
          workspaceRole?: WorkspaceRole;
        };
        if (workspaceId && (!workspaceRole || ranks[workspaceRole] < ranks[minRole])) {
          throw new TRPCError({ code: 'FORBIDDEN' });
        }
        return next();
      }),
  };
});

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/device', () => ({
  DeviceModel: class {
    findByDeviceId = mocks.findByDeviceId;
    findWorkspaceDeviceById = mocks.findWorkspaceDeviceById;
  },
}));
vi.mock('@/server/services/deviceGateway', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deviceGateway: { runGitPullRequestAction: mocks.runGitPullRequestAction },
}));

describe('PR mutation workspace boundary', () => {
  const caller = deviceRouter.createCaller({
    userId: 'member',
    workspaceId: 'workspace',
    workspaceRole: 'member',
  } as never);
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByDeviceId.mockResolvedValue(undefined);
    mocks.findWorkspaceDeviceById.mockResolvedValue({
      deviceId: 'device',
      userId: 'enroller',
      visibility: 'public',
      workingDirs: [{ path: '/approved' }],
    });
    mocks.runGitPullRequestAction.mockResolvedValue({ success: true });
  });

  const actions = [
    { headRefOid: 'a'.repeat(40), method: 'squash', type: 'merge' },
    { headRefOid: 'a'.repeat(40), method: 'squash', type: 'autoMerge' },
    { type: 'disableAutoMerge' },
    { method: 'merge', type: 'updateBranch' },
    { type: 'ready' },
    { body: 'A comment', type: 'comment' },
    { type: 'close' },
    { type: 'reopen' },
    { head: 'feature', type: 'deleteBranch' },
    { base: 'canary', type: 'changeBase' },
  ] as const;

  it.each(actions)(
    'rejects viewer action $type before reaching the shared device',
    async (action) => {
      const viewer = deviceRouter.createCaller({
        userId: 'viewer',
        workspaceId: 'workspace',
        workspaceRole: 'viewer',
      } as never);

      await expect(
        viewer.runGitPullRequestAction({
          action,
          deviceId: 'device',
          number: 42,
          path: '/approved',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mocks.runGitPullRequestAction).not.toHaveBeenCalled();
    },
  );

  it('rejects a workspace request without a role before reaching the device', async () => {
    const unverified = deviceRouter.createCaller({
      userId: 'member',
      workspaceId: 'workspace',
    } as never);

    await expect(
      unverified.runGitPullRequestAction({
        action: { type: 'close' },
        deviceId: 'device',
        number: 42,
        path: '/approved',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.runGitPullRequestAction).not.toHaveBeenCalled();
  });

  it('allows personal device writes without a workspace role', async () => {
    mocks.findByDeviceId.mockResolvedValue({ workingDirs: [{ path: '/approved' }] });
    const personal = deviceRouter.createCaller({ userId: 'enroller' } as never);

    await expect(
      personal.runGitPullRequestAction({
        action: { type: 'close' },
        deviceId: 'device',
        number: 42,
        path: '/approved',
      }),
    ).resolves.toEqual({ success: true });
  });

  it('rejects another repository before sending any command to the device', async () => {
    await expect(
      caller.runGitPullRequestAction({
        action: { type: 'close' },
        deviceId: 'device',
        number: 42,
        path: '/other',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.runGitPullRequestAction).not.toHaveBeenCalled();
  });

  it('allows a repository inside the approved root', async () => {
    await expect(
      caller.runGitPullRequestAction({
        action: { type: 'close' },
        deviceId: 'device',
        number: 42,
        path: '/approved/repo',
      }),
    ).resolves.toEqual({ success: true });
  });

  it('rejects a merge without the displayed head commit', async () => {
    await expect(
      caller.runGitPullRequestAction({
        // @ts-expect-error Old clients must fail closed instead of merging an unseen head.
        action: { method: 'squash', type: 'merge' },
        deviceId: 'device',
        number: 42,
        path: '/approved',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.runGitPullRequestAction).not.toHaveBeenCalled();
  });
});
