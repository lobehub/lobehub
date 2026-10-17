// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceRole } from '@/business/server/trpc-middlewares/workspaceAuth';

import { deviceRouter } from '../device';

const mocks = vi.hoisted(() => ({
  copyAssetForPublish: vi.fn(),
  findByDeviceId: vi.fn(),
  findWorkspaceDeviceById: vi.fn(),
  getLocalFilePreview: vi.fn(),
  readExternalAssetForPublish: vi.fn(),
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
  deviceGateway: {
    copyAssetForPublish: mocks.copyAssetForPublish,
    getLocalFilePreview: mocks.getLocalFilePreview,
    readExternalAssetForPublish: mocks.readExternalAssetForPublish,
  },
}));

type Caller = ReturnType<typeof deviceRouter.createCaller>;

const base = { deviceId: 'shared-device', workingDirectory: '/shared/project' };

// Both routes reach files outside the approved root on the device: the source
// of a copy and the external asset read are not confined to `workingDirectory`.
const routes = [
  {
    gateway: mocks.copyAssetForPublish,
    name: 'copyAssetForPublish',
    run: (caller: Caller) =>
      caller.copyAssetForPublish({
        ...base,
        from: '/outside/logo.png',
        to: '/shared/project/assets/logo.png',
      }),
  },
  {
    gateway: mocks.readExternalAssetForPublish,
    name: 'readExternalAssetForPublish',
    run: (caller: Caller) =>
      caller.readExternalAssetForPublish({ ...base, path: '/outside/logo.png' }),
  },
];

const workspaceCaller = (workspaceRole?: WorkspaceRole) =>
  deviceRouter.createCaller({
    userId: 'caller',
    workspaceId: 'workspace',
    workspaceRole,
  } as never);

describe('device publish asset workspace boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByDeviceId.mockResolvedValue(undefined);
    mocks.findWorkspaceDeviceById.mockResolvedValue({
      deviceId: base.deviceId,
      userId: 'enroller',
      visibility: 'public',
      workingDirs: [{ path: base.workingDirectory }],
      workspaceId: 'workspace',
    });
    mocks.copyAssetForPublish.mockResolvedValue({ success: true });
    mocks.readExternalAssetForPublish.mockResolvedValue({ success: true });
    mocks.getLocalFilePreview.mockResolvedValue({ success: true });
  });

  it.each(routes)(
    '$name rejects a workspace viewer before reaching the shared device',
    async ({ gateway, run }) => {
      await expect(run(workspaceCaller('viewer'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(gateway).not.toHaveBeenCalled();
    },
  );

  it.each(routes)(
    '$name rejects a workspace request without a role before reaching the device',
    async ({ gateway, run }) => {
      await expect(run(workspaceCaller())).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(gateway).not.toHaveBeenCalled();
    },
  );

  it.each(routes)(
    '$name allows a member on a public device enrolled by another member',
    async ({ gateway, run }) => {
      await expect(run(workspaceCaller('member'))).resolves.toEqual({ success: true });
      expect(gateway).toHaveBeenCalledOnce();
    },
  );

  it.each(routes)('$name allows a personal device without a workspace role', async ({ run }) => {
    mocks.findByDeviceId.mockResolvedValue({ workingDirs: [{ path: base.workingDirectory }] });
    const personal = deviceRouter.createCaller({ userId: 'enroller' } as never);

    await expect(run(personal)).resolves.toEqual({ success: true });
  });

  it('keeps read-only previews inside the approved root open to viewers', async () => {
    await expect(
      workspaceCaller('viewer').getLocalFilePreview({
        ...base,
        path: '/shared/project/index.html',
      }),
    ).resolves.toEqual({ success: true });
  });
});
