// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ManagedDeviceRegistrationConflictError } from '@/database/models/device';

import { deviceRouter } from '../device';

const mocks = vi.hoisted(() => ({
  findWorkspaceDeviceById: vi.fn(),
  register: vi.fn(),
  registerWorkspaceDevice: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/device', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DeviceModel: class {
    findWorkspaceDeviceById = mocks.findWorkspaceDeviceById;
    register = mocks.register;
    registerWorkspaceDevice = mocks.registerWorkspaceDevice;
  },
}));

const registration = { deviceId: 'managed-device', identitySource: 'machine-id' as const };

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

    await expect(
      deviceRouter
        .createCaller({
          userId: 'user',
          workspaceId: 'workspace',
          workspaceRole: 'member',
        } as never)
        .registerWorkspaceDevice(registration),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
