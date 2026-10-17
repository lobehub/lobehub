// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { router } from '@/libs/trpc/lambda';

import { workspaceDeviceWorkingDirProcedures } from '../deviceWorkspaceWorkingDirs';

const mocks = vi.hoisted(() => ({
  findWorkspaceDeviceById: vi.fn(),
  stored: [] as { path: string; workspace?: unknown }[],
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return {
    requireWorkspaceRole: () => mod.trpc.middleware(async (opts: any) => opts.next()),
    wsProcedure: mod.trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) => opts.next({ ctx: { ...opts.ctx, serverDB: {} } }),
}));
vi.mock('@/database/models/device', () => ({
  DeviceModel: class {
    findWorkspaceDeviceById = mocks.findWorkspaceDeviceById;
    mutateWorkspaceDeviceWorkingDirs = async (_id: string, mutate: (d: any[]) => any[]) => {
      mocks.stored = mutate(mocks.stored);
      return mocks.stored;
    };
  },
}));

type Role = 'member' | 'owner' | 'viewer';

const caller = (userId: string, workspaceRole: Role) =>
  router(workspaceDeviceWorkingDirProcedures).createCaller({
    userId,
    workspaceId: 'workspace',
    workspaceRole,
  } as never);

const withDevice = (visibility: 'private' | 'public') =>
  mocks.findWorkspaceDeviceById.mockResolvedValue({
    deviceId: 'device',
    userId: 'enroller',
    visibility,
  });

describe('workspace device working-dir entries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stored = [{ path: '/a', workspace: { cached: true } }, { path: '/b' }];
  });

  it('lets a member add a dir to the front of a public device list, keeping cached scans', async () => {
    withDevice('public');

    await caller('member', 'member').addWorkspaceDeviceWorkingDir({
      deviceId: 'device',
      entry: { path: '/a' },
    });
    await caller('member', 'member').addWorkspaceDeviceWorkingDir({
      deviceId: 'device',
      entry: { path: '/c' },
    });

    expect(mocks.stored).toEqual([
      { path: '/c' },
      { path: '/a', workspace: { cached: true } },
      { path: '/b' },
    ]);
  });

  it('lets a member remove one dir from a public device list', async () => {
    withDevice('public');

    await caller('member', 'member').removeWorkspaceDeviceWorkingDir({
      deviceId: 'device',
      path: '/a',
    });

    expect(mocks.stored).toEqual([{ path: '/b' }]);
  });

  it.each([
    ['a member on a private device they did not enroll', 'private', 'member'],
    ['a viewer on a public device', 'public', 'viewer'],
  ] as const)('rejects %s', async (_case, visibility, role) => {
    withDevice(visibility);

    await expect(
      caller(role, role).removeWorkspaceDeviceWorkingDir({ deviceId: 'device', path: '/a' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.stored).toHaveLength(2);
  });

  it('returns NOT_FOUND for a device outside the workspace', async () => {
    mocks.findWorkspaceDeviceById.mockResolvedValue(undefined);

    await expect(
      caller('owner', 'owner').addWorkspaceDeviceWorkingDir({
        deviceId: 'device',
        entry: { path: '/c' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
