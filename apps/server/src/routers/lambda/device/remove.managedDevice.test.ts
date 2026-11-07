// @vitest-environment node
import { MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registryRouter } from './registry';
import { workspaceRouter } from './workspace';

const mocks = vi.hoisted(() => ({
  delete: vi.fn(),
  deleteWorkspaceDevice: vi.fn(),
  findWorkspaceDeviceById: vi.fn(),
  hasFixedAgentBinding: vi.fn(),
  onManagedDeviceRemoved: vi.fn(),
  queryDeviceList: vi.fn(),
  unenrollWorkspace: vi.fn(),
}));

vi.mock('@/business/server/managedDevice', () => ({
  onManagedDeviceRemoved: mocks.onManagedDeviceRemoved,
}));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return {
    requireWorkspaceRole: () => mod.trpc.middleware(async (opts: any) => opts.next()),
    wsCompatProcedure: mod.trpc.procedure,
    wsProcedure: mod.trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) => opts.next({ ctx: { ...opts.ctx, serverDB: {} } }),
}));
vi.mock('@/database/models/device', () => ({
  DeviceModel: class {
    delete = mocks.delete;
    deleteWorkspaceDevice = mocks.deleteWorkspaceDevice;
    findWorkspaceDeviceById = mocks.findWorkspaceDeviceById;
    hasFixedAgentBinding = mocks.hasFixedAgentBinding;
  },
  WorkspaceDevicePrivateConflictError: class extends Error {},
}));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    queryDeviceList: mocks.queryDeviceList,
    unenrollWorkspace: mocks.unenrollWorkspace,
  },
}));

const row = (identitySource: string, workspaceId: string | null) => ({
  deviceId: 'device-1',
  identitySource,
  userId: 'user-1',
  workspaceId,
});

const personalCaller = () => registryRouter.createCaller({ userId: 'user-1' } as never);
const workspaceCaller = () =>
  workspaceRouter.createCaller({
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workspaceRole: 'owner',
  } as never);

describe('removing a managed cloud device', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onManagedDeviceRemoved.mockResolvedValue(undefined);
    mocks.findWorkspaceDeviceById.mockResolvedValue(row('machine-id', 'workspace-1'));
    mocks.hasFixedAgentBinding.mockResolvedValue(false);
    mocks.queryDeviceList.mockResolvedValue([]);
    mocks.unenrollWorkspace.mockResolvedValue({ success: true });
  });

  it('reports a removed personal managed device after deleting it', async () => {
    mocks.delete.mockResolvedValue([row(MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE, null)]);

    await expect(personalCaller().removeDevice({ deviceId: 'device-1' })).resolves.toEqual({
      success: true,
    });

    expect(mocks.delete).toHaveBeenCalledWith('device-1');
    expect(mocks.onManagedDeviceRemoved).toHaveBeenCalledExactlyOnceWith({
      deviceId: 'device-1',
      userId: 'user-1',
    });
    expect(mocks.delete.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.onManagedDeviceRemoved.mock.invocationCallOrder[0],
    );
  });

  it('does not report a removed connected device', async () => {
    mocks.delete.mockResolvedValue([row('machine-id', null)]);

    await personalCaller().removeDevice({ deviceId: 'device-1' });

    expect(mocks.onManagedDeviceRemoved).not.toHaveBeenCalled();
  });

  it('keeps the personal removal successful when the hook fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.delete.mockResolvedValue([row(MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE, null)]);
    mocks.onManagedDeviceRemoved.mockRejectedValue(new Error('hook failed'));

    await expect(personalCaller().removeDevice({ deviceId: 'device-1' })).resolves.toEqual({
      success: true,
    });
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it('reports a removed workspace managed device with its workspace', async () => {
    mocks.deleteWorkspaceDevice.mockResolvedValue([
      row(MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE, 'workspace-1'),
    ]);

    await expect(
      workspaceCaller().removeWorkspaceDevice({ deviceId: 'device-1' }),
    ).resolves.toEqual({ success: true });

    expect(mocks.deleteWorkspaceDevice).toHaveBeenCalledWith('device-1');
    expect(mocks.onManagedDeviceRemoved).toHaveBeenCalledExactlyOnceWith({
      deviceId: 'device-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
  });

  it('reports the enrolling member when an owner removes their workspace device', async () => {
    mocks.deleteWorkspaceDevice.mockResolvedValue([
      { ...row(MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE, 'workspace-1'), userId: 'enroller-1' },
    ]);

    await workspaceCaller().removeWorkspaceDevice({ deviceId: 'device-1' });

    expect(mocks.onManagedDeviceRemoved).toHaveBeenCalledExactlyOnceWith({
      deviceId: 'device-1',
      userId: 'enroller-1',
      workspaceId: 'workspace-1',
    });
  });

  it('does not report a removed connected workspace device', async () => {
    mocks.deleteWorkspaceDevice.mockResolvedValue([row('machine-id', 'workspace-1')]);

    await workspaceCaller().removeWorkspaceDevice({ deviceId: 'device-1' });

    expect(mocks.onManagedDeviceRemoved).not.toHaveBeenCalled();
  });

  it('keeps the workspace removal successful when the hook fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.deleteWorkspaceDevice.mockResolvedValue([
      row(MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE, 'workspace-1'),
    ]);
    mocks.onManagedDeviceRemoved.mockRejectedValue(new Error('hook failed'));

    await expect(
      workspaceCaller().removeWorkspaceDevice({ deviceId: 'device-1' }),
    ).resolves.toEqual({ success: true });
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  describe('while the device is still connected', () => {
    beforeEach(() => {
      mocks.unenrollWorkspace.mockResolvedValue({ error: 'no handler', success: false });
      mocks.queryDeviceList.mockResolvedValue([{ deviceId: 'device-1' }]);
    });

    it('removes an online workspace managed device without an unenroll acknowledgement', async () => {
      const managed = row(MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE, 'workspace-1');
      mocks.findWorkspaceDeviceById.mockResolvedValue(managed);
      mocks.deleteWorkspaceDevice.mockResolvedValue([managed]);

      await expect(
        workspaceCaller().removeWorkspaceDevice({ deviceId: 'device-1' }),
      ).resolves.toEqual({ success: true });

      expect(mocks.deleteWorkspaceDevice).toHaveBeenCalledWith('device-1');
      expect(mocks.onManagedDeviceRemoved).toHaveBeenCalledExactlyOnceWith({
        deviceId: 'device-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      });
    });

    it('refuses to remove an online ordinary device that did not acknowledge the unenroll', async () => {
      await expect(
        workspaceCaller().removeWorkspaceDevice({ deviceId: 'device-1' }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

      expect(mocks.unenrollWorkspace).toHaveBeenCalledOnce();
      expect(mocks.deleteWorkspaceDevice).not.toHaveBeenCalled();
      expect(mocks.onManagedDeviceRemoved).not.toHaveBeenCalled();
    });

    it('removes an ordinary device once it is offline', async () => {
      mocks.queryDeviceList.mockResolvedValue([]);
      mocks.deleteWorkspaceDevice.mockResolvedValue([row('machine-id', 'workspace-1')]);

      await expect(
        workspaceCaller().removeWorkspaceDevice({ deviceId: 'device-1' }),
      ).resolves.toEqual({ success: true });

      expect(mocks.deleteWorkspaceDevice).toHaveBeenCalledWith('device-1');
    });
  });
});
