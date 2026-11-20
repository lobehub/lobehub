// @vitest-environment node
import { MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE } from '@lobechat/types';
import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { devices, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DeviceModel, ManagedDeviceRegistrationConflictError } from '../device';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'devmanaged-user';
const otherUserId = 'devmanaged-other-user';
const workspaceId = 'devmanaged-workspace';
const managedId = '7d9c1f0e-5b2a-4c3d-9e8f-0a1b2c3d4e5f';

const cleanup = async () => {
  // devices / workspaces cascade from their owning user.
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
};

const insertManaged = (values: { userId: string; workspaceId?: string }) =>
  serverDB.insert(devices).values({
    deviceId: managedId,
    hostname: 'managed-host',
    identitySource: MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE,
    lastSeenAt: new Date('2026-01-01T00:00:00Z'),
    metadata: { cliVersion: '1.0.0' },
    platform: 'linux',
    visibility: 'public',
    ...values,
  });

const findManaged = (scope: { workspaceId?: string }) =>
  serverDB.query.devices.findFirst({
    where: and(
      eq(devices.deviceId, managedId),
      scope.workspaceId ? eq(devices.workspaceId, scope.workspaceId) : undefined,
    ),
  });

const clientRegistration = {
  architecture: 'arm64',
  deviceId: managedId,
  hostname: 'client-host',
  identitySource: 'machine-id',
  metadata: { appVersion: '9.9.9' },
  platform: 'darwin',
};

describe('DeviceModel client writes to a managed cloud device row', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'devmanaged workspace',
      primaryOwnerId: userId,
      slug: 'devmanaged-workspace',
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('register', () => {
    it('rejects a client registration and leaves the managed row unchanged', async () => {
      await insertManaged({ userId });
      const before = await findManaged({});

      await expect(new DeviceModel(serverDB, userId).register(clientRegistration)).rejects.toThrow(
        ManagedDeviceRegistrationConflictError,
      );

      expect(await findManaged({})).toEqual(before);
    });

    it('still registers a new id with the managed identity source', async () => {
      const row = await new DeviceModel(serverDB, userId).register({
        deviceId: managedId,
        identitySource: MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE,
      });

      expect(row).toMatchObject({
        deviceId: managedId,
        identitySource: MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE,
      });
    });

    it('keeps refreshing a client device on re-registration', async () => {
      const model = new DeviceModel(serverDB, userId);
      await model.register({ deviceId: 'client-device', identitySource: 'fallback' });

      const row = await model.register({
        deviceId: 'client-device',
        hostname: 'renamed-host',
        identitySource: 'machine-id',
      });

      expect(row).toMatchObject({ hostname: 'renamed-host', identitySource: 'machine-id' });
    });
  });

  describe('registerWorkspaceDevice', () => {
    it('rejects re-enrolling a managed workspace device and leaves it unchanged', async () => {
      await insertManaged({ userId, workspaceId });
      const before = await findManaged({ workspaceId });

      await expect(
        new DeviceModel(serverDB, otherUserId, workspaceId).registerWorkspaceDevice({
          ...clientRegistration,
          visibility: 'public',
          workspaceId,
        }),
      ).rejects.toThrow(ManagedDeviceRegistrationConflictError);

      expect(await findManaged({ workspaceId })).toEqual(before);
    });

    it('rejects the enrolling member too', async () => {
      await insertManaged({ userId, workspaceId });

      await expect(
        new DeviceModel(serverDB, userId, workspaceId).registerWorkspaceDevice({
          ...clientRegistration,
          workspaceId,
        }),
      ).rejects.toThrow(ManagedDeviceRegistrationConflictError);

      expect((await findManaged({ workspaceId }))?.identitySource).toBe(
        MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE,
      );
    });

    it('keeps refreshing a client workspace device on re-enrollment', async () => {
      const model = new DeviceModel(serverDB, userId, workspaceId);
      await model.registerWorkspaceDevice({
        deviceId: 'client-ws-device',
        identitySource: 'machine-id',
        workspaceId,
      });

      const row = await model.registerWorkspaceDevice({
        deviceId: 'client-ws-device',
        hostname: 'renamed-host',
        identitySource: 'machine-id',
        workspaceId,
      });

      expect(row).toMatchObject({ hostname: 'renamed-host' });
    });
  });

  describe('overwriteSharedWorkspaceDevice', () => {
    it('leaves a managed workspace row unchanged', async () => {
      await insertManaged({ userId, workspaceId });
      const before = await findManaged({ workspaceId });

      const row = await new DeviceModel(
        serverDB,
        otherUserId,
        workspaceId,
      ).overwriteSharedWorkspaceDevice(managedId, {
        sharedFromDeviceId: 'other-laptop',
        visibility: 'private',
      });

      expect(row).toBeUndefined();
      expect(await findManaged({ workspaceId })).toEqual(before);
    });
  });

  describe('updateDeviceInfo', () => {
    it('leaves a managed personal row unchanged', async () => {
      await insertManaged({ userId });
      const before = await findManaged({});

      const row = await new DeviceModel(serverDB, userId).updateDeviceInfo(managedId, {
        architecture: 'arm64',
        hostname: 'client-host',
      });

      expect(row).toBeUndefined();
      expect(await findManaged({})).toEqual(before);
    });
  });
});
