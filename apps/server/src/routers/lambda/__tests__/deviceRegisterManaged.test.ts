// @vitest-environment node
import { MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ManagedDeviceRegistrationConflictError } from '@/database/models/device';

import { deviceRouter } from '../device';

const mocks = vi.hoisted(() => ({
  assertNoCrossUserPrivateConflict: vi.fn(),
  enrollWorkspace: vi.fn(),
  findByDeviceId: vi.fn(),
  findWorkspaceDeviceById: vi.fn(),
  overwriteSharedWorkspaceDevice: vi.fn(),
  register: vi.fn(),
  registerWorkspaceDevice: vi.fn(),
  unenrollWorkspace: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/device', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DeviceModel: class {
    assertNoCrossUserPrivateConflict = mocks.assertNoCrossUserPrivateConflict;
    findByDeviceId = mocks.findByDeviceId;
    findWorkspaceDeviceById = mocks.findWorkspaceDeviceById;
    overwriteSharedWorkspaceDevice = mocks.overwriteSharedWorkspaceDevice;
    register = mocks.register;
    registerWorkspaceDevice = mocks.registerWorkspaceDevice;
  },
}));
vi.mock('@/libs/trpc/utils/internalJwt', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  signWorkspaceDeviceToken: vi.fn().mockResolvedValue('workspace-token'),
}));
vi.mock('@/server/services/deviceGateway', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deviceGateway: {
    enrollWorkspace: mocks.enrollWorkspace,
    unenrollWorkspace: mocks.unenrollWorkspace,
  },
}));

const registration = { deviceId: 'managed-device', identitySource: 'machine-id' as const };

const workspaceCaller = () =>
  deviceRouter.createCaller({
    userId: 'user',
    workspaceId: 'workspace',
    workspaceRole: 'member',
  } as never);

describe('registering a managed cloud device id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findWorkspaceDeviceById.mockResolvedValue(undefined);
  });

  it('answers a personal registration with CONFLICT', async () => {
    mocks.register.mockRejectedValue(new ManagedDeviceRegistrationConflictError('managed-device'));

    await expect(
      deviceRouter.createCaller({ userId: 'user' } as never).register(registration),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('answers a workspace enrollment with CONFLICT', async () => {
    mocks.registerWorkspaceDevice.mockRejectedValue(
      new ManagedDeviceRegistrationConflictError('managed-device'),
    );

    await expect(workspaceCaller().registerWorkspaceDevice(registration)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

describe('sharing a device into a workspace', () => {
  const personal = {
    deviceId: 'laptop',
    friendlyName: null,
    hostname: 'laptop',
    identitySource: 'machine-id',
    platform: 'linux',
    userId: 'user',
    workspaceId: null,
  };
  const identity = { deviceId: 'laptop-workspace', identitySource: 'machine-id' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByDeviceId.mockResolvedValue(personal);
    mocks.findWorkspaceDeviceById.mockResolvedValue(undefined);
    mocks.enrollWorkspace.mockResolvedValue({ identity, success: true });
    mocks.registerWorkspaceDevice.mockResolvedValue({
      deviceId: identity.deviceId,
      friendlyName: null,
      visibility: 'private',
    });
  });

  it('refuses a device that reports the managed identity source on the probe', async () => {
    mocks.enrollWorkspace.mockResolvedValue({
      identity: { ...identity, identitySource: MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE },
      success: true,
    });

    await expect(
      workspaceCaller().shareDeviceToWorkspace({ deviceId: 'laptop' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(mocks.enrollWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.registerWorkspaceDevice).not.toHaveBeenCalled();
  });

  it('rolls back and refuses when the enrollment reports the managed identity source', async () => {
    mocks.enrollWorkspace.mockResolvedValueOnce({ identity, success: true }).mockResolvedValueOnce({
      identity: { ...identity, identitySource: MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE },
      success: true,
    });

    await expect(
      workspaceCaller().shareDeviceToWorkspace({ deviceId: 'laptop' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(mocks.registerWorkspaceDevice).not.toHaveBeenCalled();
    expect(mocks.unenrollWorkspace).toHaveBeenCalledWith({
      deviceId: identity.deviceId,
      userId: 'user',
      workspaceId: 'workspace',
    });
  });

  it('refuses to overwrite a managed workspace row before enrolling the device', async () => {
    mocks.findWorkspaceDeviceById.mockResolvedValue({
      deviceId: identity.deviceId,
      identitySource: MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE,
      userId: 'user',
      visibility: 'public',
    });

    await expect(
      workspaceCaller().shareDeviceToWorkspace({
        confirmOverwrite: true,
        deviceId: 'laptop',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    // Only the identity-only probe ran; the device opened no share connection.
    expect(mocks.enrollWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.enrollWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ identityOnly: true }),
    );
    expect(mocks.overwriteSharedWorkspaceDevice).not.toHaveBeenCalled();
  });

  it('refuses to share a managed personal device', async () => {
    mocks.findByDeviceId.mockResolvedValue({
      ...personal,
      identitySource: MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE,
    });

    await expect(
      workspaceCaller().shareDeviceToWorkspace({ deviceId: 'laptop' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.enrollWorkspace).not.toHaveBeenCalled();
  });

  it('registers a client identity source', async () => {
    await expect(
      workspaceCaller().shareDeviceToWorkspace({ deviceId: 'laptop' }),
    ).resolves.toMatchObject({ deviceId: identity.deviceId, success: true });
    expect(mocks.registerWorkspaceDevice).toHaveBeenCalledWith(
      expect.objectContaining({ identitySource: 'machine-id' }),
    );
  });
});
