// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceRouter } from '../device';

const mocks = vi.hoisted(() => ({
  checkAppUpdate: vi.fn(),
  findWorkspaceDeviceById: vi.fn(),
  getAppUpdateState: vi.fn(),
  installAppUpdate: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/device', () => ({
  DeviceModel: class {
    findWorkspaceDeviceById = mocks.findWorkspaceDeviceById;
  },
}));
vi.mock('@/server/services/deviceGateway', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deviceGateway: {
    checkAppUpdate: mocks.checkAppUpdate,
    getAppUpdateState: mocks.getAppUpdateState,
    installAppUpdate: mocks.installAppUpdate,
  },
}));

const workspaceCaller = (userId: string, workspaceRole: 'member' | 'owner') =>
  deviceRouter.createCaller({ userId, workspaceId: 'workspace', workspaceRole } as never);

describe('remote app update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findWorkspaceDeviceById.mockResolvedValue({ deviceId: 'device', userId: 'enroller' });
    mocks.installAppUpdate.mockResolvedValue({ status: 'ok', targetVersion: '2.2.0' });
  });

  it('lets the enrolling member restart a workspace device into its update', async () => {
    await expect(
      workspaceCaller('enroller', 'member').installAppUpdate({ deviceId: 'device' }),
    ).resolves.toEqual({ status: 'ok', targetVersion: '2.2.0' });
    expect(mocks.installAppUpdate).toHaveBeenCalledWith({
      deviceId: 'device',
      userId: 'enroller',
      workspaceId: 'workspace',
    });
  });

  it('lets a workspace owner update a device another member enrolled', async () => {
    await expect(
      workspaceCaller('owner', 'owner').installAppUpdate({ deviceId: 'device' }),
    ).resolves.toMatchObject({ status: 'ok' });
  });

  it.each(['getAppUpdateState', 'checkAppUpdate', 'installAppUpdate'] as const)(
    "rejects %s from a member on someone else's workspace device",
    async (procedure) => {
      const caller = workspaceCaller('member', 'member');
      await expect(caller[procedure]({ deviceId: 'device' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(mocks[procedure]).not.toHaveBeenCalled();
    },
  );
});
