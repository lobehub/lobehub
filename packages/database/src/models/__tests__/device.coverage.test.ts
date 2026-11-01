// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { devices, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DeviceModel, WorkspaceDevicePrivateConflictError } from '../device';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'devcov-user';
const otherUserId = 'devcov-other-user';
const workspaceId = 'devcov-workspace';

const cleanup = async () => {
  // devices / workspaces cascade from their owning user.
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
};

const findRow = (deviceId: string) =>
  serverDB.query.devices.findFirst({ where: eq(devices.deviceId, deviceId) });

describe('DeviceModel coverage edges', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'devcov workspace',
      primaryOwnerId: userId,
      slug: 'devcov-workspace',
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('without a current workspace', () => {
    const personalModel = new DeviceModel(serverDB, userId);

    it('skips the private-conflict check when no workspace is known', async () => {
      await new DeviceModel(serverDB, otherUserId).registerWorkspaceDevice({
        deviceId: 'devcov-private',
        identitySource: 'machine-id',
        workspaceId,
      });

      await expect(
        personalModel.assertNoCrossUserPrivateConflict('devcov-private'),
      ).resolves.toBeUndefined();
    });

    it('leaves workspace devices untouched and reports nothing', async () => {
      await new DeviceModel(serverDB, userId, workspaceId).registerWorkspaceDevice({
        deviceId: 'devcov-ws',
        identitySource: 'machine-id',
        workspaceId,
      });
      const mutate = (dirs: { path: string }[]) => [...dirs, { path: '/nope' }];

      await expect(
        personalModel.updateWorkspaceDevice('devcov-ws', { friendlyName: 'renamed' }),
      ).resolves.toBeUndefined();
      await expect(
        personalModel.mutateWorkspaceDeviceWorkingDirs('devcov-ws', mutate),
      ).resolves.toBeUndefined();
      await expect(
        personalModel.setWorkspaceDeviceVisibility('devcov-ws', 'public'),
      ).resolves.toBeUndefined();
      await expect(
        personalModel.overwriteSharedWorkspaceDevice('devcov-ws', {
          sharedFromDeviceId: 'devcov-personal',
          visibility: 'public',
        }),
      ).resolves.toBeUndefined();
      await expect(personalModel.deleteWorkspaceDevice('devcov-ws')).resolves.toBeUndefined();

      expect(await findRow('devcov-ws')).toMatchObject({
        friendlyName: null,
        sharedFromDeviceId: null,
        visibility: 'private',
        workingDirs: [],
        workspaceId,
      });
    });
  });

  describe('with the current workspace', () => {
    const workspaceModel = new DeviceModel(serverDB, userId, workspaceId);

    it('falls back to the current workspace for the private-conflict check', async () => {
      await new DeviceModel(serverDB, otherUserId, workspaceId).registerWorkspaceDevice({
        deviceId: 'devcov-private',
        identitySource: 'machine-id',
        workspaceId,
      });

      await expect(
        workspaceModel.assertNoCrossUserPrivateConflict('devcov-private'),
      ).rejects.toBeInstanceOf(WorkspaceDevicePrivateConflictError);
    });

    it('treats a null workingDirs column as an empty list', async () => {
      await workspaceModel.registerWorkspaceDevice({
        deviceId: 'devcov-null-dirs',
        identitySource: 'machine-id',
        workspaceId,
      });
      await serverDB
        .update(devices)
        .set({ workingDirs: null })
        .where(eq(devices.deviceId, 'devcov-null-dirs'));

      const seen: unknown[] = [];
      const next = await workspaceModel.mutateWorkspaceDeviceWorkingDirs(
        'devcov-null-dirs',
        (current) => {
          seen.push(current);
          return [...current, { path: '/srv/app' }];
        },
      );

      expect(seen).toEqual([[]]);
      expect(next).toEqual([{ path: '/srv/app' }]);
      expect((await findRow('devcov-null-dirs'))?.workingDirs).toEqual([{ path: '/srv/app' }]);
    });

    it('deletes only the device in the current workspace', async () => {
      await workspaceModel.registerWorkspaceDevice({
        deviceId: 'devcov-shared-id',
        identitySource: 'machine-id',
        workspaceId,
      });
      await workspaceModel.register({ deviceId: 'devcov-shared-id', identitySource: 'machine-id' });

      await workspaceModel.deleteWorkspaceDevice('devcov-shared-id');

      const remaining = await serverDB.query.devices.findMany({
        where: eq(devices.deviceId, 'devcov-shared-id'),
      });
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({ userId, workspaceId: null });
    });
  });
});
