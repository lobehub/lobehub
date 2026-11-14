// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceRouter } from '../device';

const mocks = vi.hoisted(() => ({
  findWorkspaceDeviceById: vi.fn(),
  requestManagedDeviceWake: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/device', () => ({
  DeviceModel: class {
    findWorkspaceDeviceById = mocks.findWorkspaceDeviceById;
  },
}));
vi.mock('@/server/services/deviceGateway/managedDeviceWake', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestManagedDeviceWake: mocks.requestManagedDeviceWake,
}));

const personalCaller = () => deviceRouter.createCaller({ userId: 'user-1' } as never);
const workspaceCaller = (userId: string, workspaceRole: 'member' | 'viewer') =>
  deviceRouter.createCaller({ userId, workspaceId: 'workspace', workspaceRole } as never);

describe('device.wakeManagedDevice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestManagedDeviceWake.mockResolvedValue('accepted');
    mocks.findWorkspaceDeviceById.mockResolvedValue({
      deviceId: 'managed-a',
      userId: 'enroller',
      visibility: 'public',
    });
  });

  it('asks the provider to wake a personal managed device', async () => {
    await expect(personalCaller().wakeManagedDevice({ deviceId: 'managed-a' })).resolves.toEqual({
      success: true,
    });
    expect(mocks.requestManagedDeviceWake).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', workspaceId: undefined }),
      'managed-a',
    );
  });

  it('wakes a public workspace device for any member', async () => {
    await expect(
      workspaceCaller('member', 'member').wakeManagedDevice({ deviceId: 'managed-a' }),
    ).resolves.toEqual({ success: true });
    expect(mocks.requestManagedDeviceWake).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'member', workspaceId: 'workspace' }),
      'managed-a',
    );
  });

  it('refuses a workspace viewer', async () => {
    await expect(
      workspaceCaller('viewer', 'viewer').wakeManagedDevice({ deviceId: 'managed-a' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.requestManagedDeviceWake).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND for a device that is not a managed cloud device', async () => {
    mocks.requestManagedDeviceWake.mockResolvedValue('not-managed');

    await expect(
      personalCaller().wakeManagedDevice({ deviceId: 'desktop-a' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('answers BAD_GATEWAY when the provider refuses the wake', async () => {
    mocks.requestManagedDeviceWake.mockRejectedValue(new Error('limit reached'));

    await expect(
      personalCaller().wakeManagedDevice({ deviceId: 'managed-a' }),
    ).rejects.toMatchObject({ code: 'BAD_GATEWAY' });
  });
});
