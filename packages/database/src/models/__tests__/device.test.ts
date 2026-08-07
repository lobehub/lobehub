// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, devices, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DeviceModel, WorkspaceDevicePrivateConflictError } from '../device';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'device-model-test-user-id';
const otherUserId = 'device-model-other-user';
const wsId = 'device-model-ws-1';
const deviceModel = new DeviceModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(devices).where(eq(devices.userId, userId));
});

describe('DeviceModel', () => {
  describe('register', () => {
    it('should insert a new device', async () => {
      const result = await deviceModel.register({
        deviceId: 'dev-1',
        hostname: 'My-Mac.local',
        identitySource: 'machine-id',
        platform: 'darwin',
      });

      expect(result.id).toBeDefined();
      expect(result).toMatchObject({
        deviceId: 'dev-1',
        hostname: 'My-Mac.local',
        identitySource: 'machine-id',
        platform: 'darwin',
        userId,
      });
    });

    it('should upsert on (userId, deviceId) and refresh machine fields', async () => {
      await deviceModel.register({
        deviceId: 'dev-1',
        hostname: 'old-host',
        identitySource: 'fallback',
        platform: 'linux',
      });

      await deviceModel.register({
        deviceId: 'dev-1',
        hostname: 'new-host',
        identitySource: 'machine-id',
        platform: 'darwin',
      });

      const rows = await serverDB.query.devices.findMany({
        where: and(eq(devices.userId, userId), eq(devices.deviceId, 'dev-1')),
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        hostname: 'new-host',
        identitySource: 'machine-id',
        platform: 'darwin',
      });
    });

    it('should NOT overwrite user-owned fields on re-register', async () => {
      await deviceModel.register({
        deviceId: 'dev-1',
        hostname: 'host',
        identitySource: 'machine-id',
        platform: 'darwin',
      });
      await deviceModel.update('dev-1', {
        defaultCwd: '/Users/me/work',
        friendlyName: 'My Work Mac',
        workingDirs: [{ path: '/Users/me/work' }, { path: '/Users/me/tmp', repoType: 'github' }],
      });

      // Re-register (e.g. user logs in again / reconnects)
      await deviceModel.register({
        deviceId: 'dev-1',
        hostname: 'host',
        identitySource: 'machine-id',
        platform: 'darwin',
      });

      const row = await deviceModel.findByDeviceId('dev-1');
      expect(row).toMatchObject({
        defaultCwd: '/Users/me/work',
        friendlyName: 'My Work Mac',
        workingDirs: [{ path: '/Users/me/work' }, { path: '/Users/me/tmp', repoType: 'github' }],
      });
    });
  });

  describe('query', () => {
    it('should return only the current user devices, newest lastSeen first', async () => {
      await deviceModel.register({ deviceId: 'dev-old', identitySource: 'machine-id' });
      await deviceModel.register({ deviceId: 'dev-new', identitySource: 'machine-id' });
      // The in-memory test DB may assign both inserts the same millisecond.
      // Pin distinct timestamps so this ordering assertion is deterministic.
      await serverDB
        .update(devices)
        .set({ lastSeenAt: new Date('2026-01-01T00:00:00.000Z') })
        .where(eq(devices.deviceId, 'dev-old'));
      await serverDB
        .update(devices)
        .set({ lastSeenAt: new Date('2026-01-02T00:00:00.000Z') })
        .where(eq(devices.deviceId, 'dev-new'));
      // a device owned by another user must not leak
      await new DeviceModel(serverDB, 'device-model-other-user').register({
        deviceId: 'other-dev',
        identitySource: 'machine-id',
      });

      const list = await deviceModel.query();
      expect(list.map((d) => d.deviceId)).toEqual(['dev-new', 'dev-old']);
    });
  });

  describe('workspace devices', () => {
    beforeEach(async () => {
      await serverDB
        .insert(workspaces)
        .values({ id: wsId, name: 'WS 1', primaryOwnerId: userId, slug: 'device-model-ws-1-slug' });
    });

    it('queryPersonal excludes workspace-enrolled rows', async () => {
      await deviceModel.register({ deviceId: 'p1', identitySource: 'machine-id' });
      // an admin-enrolled workspace device owned by this user
      await serverDB
        .insert(devices)
        .values({ deviceId: 'w1', identitySource: 'machine-id', userId, workspaceId: wsId });

      const personal = await deviceModel.queryPersonal();
      expect(personal.map((d) => d.deviceId)).toEqual(['p1']);
    });

    it('detects whether a workspace device is referenced by a fixed agent', async () => {
      await serverDB.insert(devices).values({
        deviceId: 'fixed-device',
        identitySource: 'machine-id',
        userId,
        visibility: 'public',
        workspaceId: wsId,
      });
      await serverDB.insert(agents).values({
        agencyConfig: {
          boundDeviceId: 'fixed-device',
          executionTargetSelectionPolicy: 'fixed',
          executionTarget: 'device',
        },
        id: 'fixed-agent',
        title: 'Fixed agent',
        userId,
        workspaceId: wsId,
      });

      const wsModel = new DeviceModel(serverDB, userId, wsId);
      expect(await wsModel.hasFixedAgentBinding('fixed-device')).toBe(true);
      expect(await wsModel.hasFixedAgentBinding('other-device')).toBe(false);
      expect(await deviceModel.hasFixedAgentBinding('fixed-device')).toBe(false);
    });

    it('ignores a stale device id on a fixed non-device target', async () => {
      await serverDB.insert(agents).values({
        agencyConfig: {
          boundDeviceId: 'stale-device',
          executionTarget: 'sandbox',
          executionTargetSelectionPolicy: 'fixed',
        },
        id: 'fixed-sandbox-agent',
        title: 'Fixed sandbox agent',
        userId,
        workspaceId: wsId,
      });

      const wsModel = new DeviceModel(serverDB, userId, wsId);
      expect(await wsModel.hasFixedAgentBinding('stale-device')).toBe(false);
    });

    it('queryWorkspaceDevices returns every enrolled device (any owner), scoped to the workspace', async () => {
      // enrolled by two different admins into the same workspace (public —
      // another member's default-private enrollment is covered by the
      // visibility suite below)
      await serverDB.insert(devices).values([
        { deviceId: 'w1', identitySource: 'machine-id', userId, workspaceId: wsId },
        {
          deviceId: 'w2',
          identitySource: 'machine-id',
          userId: otherUserId,
          visibility: 'public',
          workspaceId: wsId,
        },
      ]);
      // a personal device must not appear
      await deviceModel.register({ deviceId: 'p1', identitySource: 'machine-id' });

      const wsModel = new DeviceModel(serverDB, userId, wsId);
      const ids = (await wsModel.queryWorkspaceDevices()).map((d) => d.deviceId).sort();
      expect(ids).toEqual(['w1', 'w2']);
    });

    it('queryWorkspaceDevices returns [] without workspace context', async () => {
      await serverDB
        .insert(devices)
        .values({ deviceId: 'w1', identitySource: 'machine-id', userId, workspaceId: wsId });
      expect(await deviceModel.queryWorkspaceDevices()).toEqual([]);
    });

    it('dedupes a machine enrolled into one workspace by different admins to a single row', async () => {
      // admin A enrolls machine "wdev" into the workspace (public — a
      // cross-user collision with a PRIVATE row fails closed, covered in the
      // visibility suite below)
      await new DeviceModel(serverDB, userId, wsId).registerWorkspaceDevice({
        deviceId: 'wdev',
        hostname: 'A-host',
        identitySource: 'machine-id',
        visibility: 'public',
        workspaceId: wsId,
      });
      // admin B enrolls the SAME machine (same deviceId) into the SAME workspace
      await new DeviceModel(serverDB, otherUserId, wsId).registerWorkspaceDevice({
        deviceId: 'wdev',
        hostname: 'B-host',
        identitySource: 'machine-id',
        workspaceId: wsId,
      });

      const rows = (await new DeviceModel(serverDB, userId, wsId).queryWorkspaceDevices()).filter(
        (d) => d.deviceId === 'wdev',
      );
      // one row, not two — (workspace_id, device_id) is unique
      expect(rows).toHaveLength(1);
      // the original enroller is preserved; only machine fields are refreshed
      expect(rows[0].userId).toBe(userId);
      expect(rows[0].hostname).toBe('B-host');
    });

    describe('visibility (private workspace devices)', () => {
      it('queryWorkspaceDevices returns public rows plus only MY private rows', async () => {
        await serverDB.insert(devices).values([
          {
            deviceId: 'pub',
            identitySource: 'machine-id',
            userId: otherUserId,
            visibility: 'public',
            workspaceId: wsId,
          },
          {
            deviceId: 'mine-private',
            identitySource: 'machine-id',
            userId,
            visibility: 'private',
            workspaceId: wsId,
          },
          {
            deviceId: 'theirs-private',
            identitySource: 'machine-id',
            userId: otherUserId,
            visibility: 'private',
            workspaceId: wsId,
          },
        ]);

        const ids = (await new DeviceModel(serverDB, userId, wsId).queryWorkspaceDevices())
          .map((d) => d.deviceId)
          .sort();
        expect(ids).toEqual(['mine-private', 'pub']);
      });

      it('queryWorkspaceHiddenDeviceIds returns only other members private device ids', async () => {
        await serverDB.insert(devices).values([
          {
            deviceId: 'pub',
            identitySource: 'machine-id',
            userId: otherUserId,
            visibility: 'public',
            workspaceId: wsId,
          },
          {
            deviceId: 'mine-private',
            identitySource: 'machine-id',
            userId,
            visibility: 'private',
            workspaceId: wsId,
          },
          {
            deviceId: 'theirs-private',
            identitySource: 'machine-id',
            userId: otherUserId,
            visibility: 'private',
            workspaceId: wsId,
          },
        ]);

        const hidden = await new DeviceModel(
          serverDB,
          userId,
          wsId,
        ).queryWorkspaceHiddenDeviceIds();
        expect(hidden).toEqual(['theirs-private']);
        expect(await deviceModel.queryWorkspaceHiddenDeviceIds()).toEqual([]);
      });

      it('findWorkspaceDeviceById fails closed on another member private device', async () => {
        await serverDB.insert(devices).values({
          deviceId: 'theirs-private',
          identitySource: 'machine-id',
          userId: otherUserId,
          visibility: 'private',
          workspaceId: wsId,
        });

        expect(
          await new DeviceModel(serverDB, userId, wsId).findWorkspaceDeviceById('theirs-private'),
        ).toBeUndefined();
        // the enroller still resolves their own private device
        expect(
          (
            await new DeviceModel(serverDB, otherUserId, wsId).findWorkspaceDeviceById(
              'theirs-private',
            )
          )?.deviceId,
        ).toBe('theirs-private');
      });

      it('registerWorkspaceDevice defaults to private and preserves visibility on same-member re-enroll', async () => {
        const wsModel = new DeviceModel(serverDB, userId, wsId);
        const created = await wsModel.registerWorkspaceDevice({
          deviceId: 'wdev',
          identitySource: 'machine-id',
          workspaceId: wsId,
        });
        expect(created?.visibility).toBe('private');

        await wsModel.setWorkspaceDeviceVisibility('wdev', 'public');
        // same member re-enrolls (e.g. reconnect) — their private/public choice
        // must survive
        const reenrolled = await wsModel.registerWorkspaceDevice({
          deviceId: 'wdev',
          identitySource: 'machine-id',
          workspaceId: wsId,
        });
        expect(reenrolled?.visibility).toBe('public');
        expect(reenrolled?.userId).toBe(userId);
      });

      it('registerWorkspaceDevice honors an explicit public choice on re-enroll', async () => {
        const wsModel = new DeviceModel(serverDB, userId, wsId);
        await wsModel.registerWorkspaceDevice({
          deviceId: 'wdev',
          identitySource: 'machine-id',
          workspaceId: wsId,
        });

        // `lh connect --workspace … --public` on an existing private enrollment
        // must promote it — an ignored explicit flag would be a silent no-op
        const promoted = await wsModel.registerWorkspaceDevice({
          deviceId: 'wdev',
          identitySource: 'machine-id',
          visibility: 'public',
          workspaceId: wsId,
        });
        expect(promoted?.visibility).toBe('public');
      });

      it('overwriteSharedWorkspaceDevice applies visibility and links the personal twin', async () => {
        const wsModel = new DeviceModel(serverDB, userId, wsId);
        // pre-existing direct CLI enrollment: public, no share link
        await wsModel.registerWorkspaceDevice({
          deviceId: 'wdev',
          identitySource: 'machine-id',
          visibility: 'public',
          workspaceId: wsId,
        });

        // a plain re-share upsert would preserve 'public' — the confirmed
        // overwrite must apply the explicit choice and link the personal row
        const row = await wsModel.overwriteSharedWorkspaceDevice('wdev', {
          sharedFromDeviceId: 'my-personal',
          visibility: 'private',
        });
        expect(row?.visibility).toBe('private');
        expect(row?.sharedFromDeviceId).toBe('my-personal');
        expect(row?.userId).toBe(userId);
      });

      it('overwriteSharedWorkspaceDevice transfers ownership to the sharer on cross-user overwrite', async () => {
        // another member originally enrolled the machine directly via CLI
        await new DeviceModel(serverDB, otherUserId, wsId).registerWorkspaceDevice({
          deviceId: 'wdev',
          identitySource: 'machine-id',
          visibility: 'public',
          workspaceId: wsId,
        });

        // the sharer (e.g. a workspace owner) confirms overwriting it as a
        // share from their personal device — the row must follow the sharer,
        // or their share list / revoke UI can never surface it
        const sharer = new DeviceModel(serverDB, userId, wsId);
        const row = await sharer.overwriteSharedWorkspaceDevice('wdev', {
          sharedFromDeviceId: 'my-personal',
          visibility: 'private',
        });
        expect(row?.userId).toBe(userId);

        const sharerShares = await sharer.querySharedWorkspaceDevices();
        expect(sharerShares.map((s) => s.deviceId)).toContain('wdev');
        const enrollerShares = await new DeviceModel(
          serverDB,
          otherUserId,
          wsId,
        ).querySharedWorkspaceDevices();
        expect(enrollerShares.map((s) => s.deviceId)).not.toContain('wdev');
      });

      it('a DIFFERENT member colliding with a private enrollment fails closed', async () => {
        await new DeviceModel(serverDB, userId, wsId).registerWorkspaceDevice({
          deviceId: 'wdev',
          identitySource: 'machine-id',
          visibility: 'private',
          workspaceId: wsId,
        });

        // deviceId is client-supplied — the server can't prove this is the same
        // physical machine, so the collision must not publish (or otherwise
        // mutate) the enroller's private row.
        await expect(
          new DeviceModel(serverDB, otherUserId, wsId).registerWorkspaceDevice({
            deviceId: 'wdev',
            identitySource: 'machine-id',
            workspaceId: wsId,
          }),
        ).rejects.toThrow(WorkspaceDevicePrivateConflictError);

        // the enroller's row is untouched
        const row = await new DeviceModel(serverDB, userId, wsId).findWorkspaceDeviceById('wdev');
        expect(row?.visibility).toBe('private');
        expect(row?.userId).toBe(userId);
      });

      it('a DIFFERENT member re-enrolling a PUBLIC machine refreshes it without demoting', async () => {
        await new DeviceModel(serverDB, userId, wsId).registerWorkspaceDevice({
          deviceId: 'wdev',
          identitySource: 'machine-id',
          visibility: 'public',
          workspaceId: wsId,
        });

        // legit shared-infra flow: second member re-enrolls the shared box
        const row = await new DeviceModel(serverDB, otherUserId, wsId).registerWorkspaceDevice({
          deviceId: 'wdev',
          identitySource: 'machine-id',
          workspaceId: wsId,
        });
        expect(row?.visibility).toBe('public');
        // the original enroller is preserved
        expect(row?.userId).toBe(userId);
      });

      it('querySharedWorkspaceDevices returns only my shared-from-personal rows', async () => {
        await serverDB.insert(devices).values([
          // shared from my personal device — returned
          {
            deviceId: 'ws-twin',
            identitySource: 'machine-id',
            sharedFromDeviceId: 'my-personal',
            userId,
            visibility: 'private',
            workspaceId: wsId,
          },
          // my direct CLI enrollment (no share link) — excluded
          {
            deviceId: 'cli-enrolled',
            identitySource: 'machine-id',
            userId,
            visibility: 'public',
            workspaceId: wsId,
          },
          // someone else's share — excluded
          {
            deviceId: 'their-twin',
            identitySource: 'machine-id',
            sharedFromDeviceId: 'their-personal',
            userId: otherUserId,
            visibility: 'private',
            workspaceId: wsId,
          },
        ]);

        const shares = await new DeviceModel(serverDB, userId, wsId).querySharedWorkspaceDevices();
        expect(shares).toHaveLength(1);
        expect(shares[0]).toMatchObject({
          deviceId: 'ws-twin',
          sharedFromDeviceId: 'my-personal',
          visibility: 'private',
          workspaceId: wsId,
        });
      });

      it('setWorkspaceDeviceVisibility toggles both directions', async () => {
        const wsModel = new DeviceModel(serverDB, userId, wsId);
        await wsModel.registerWorkspaceDevice({
          deviceId: 'wdev',
          identitySource: 'machine-id',
          visibility: 'private',
          workspaceId: wsId,
        });

        const published = await wsModel.setWorkspaceDeviceVisibility('wdev', 'public');
        expect(published?.visibility).toBe('public');

        const demoted = await wsModel.setWorkspaceDeviceVisibility('wdev', 'private');
        expect(demoted?.visibility).toBe('private');
      });
    });

    it('findWorkspaceDeviceById is scoped to the workspace', async () => {
      await serverDB
        .insert(devices)
        .values({ deviceId: 'w1', identitySource: 'machine-id', userId, workspaceId: wsId });
      const wsModel = new DeviceModel(serverDB, userId, wsId);
      expect((await wsModel.findWorkspaceDeviceById('w1'))?.deviceId).toBe('w1');
      // a non-workspace model never resolves it
      expect(await deviceModel.findWorkspaceDeviceById('w1')).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update user-editable fields', async () => {
      await deviceModel.register({ deviceId: 'dev-1', identitySource: 'machine-id' });

      await deviceModel.update('dev-1', { friendlyName: 'Renamed' });

      const row = await deviceModel.findByDeviceId('dev-1');
      expect(row?.friendlyName).toBe('Renamed');
    });

    it('should not affect another user device with the same deviceId', async () => {
      await deviceModel.register({ deviceId: 'shared-id', identitySource: 'machine-id' });
      const other = new DeviceModel(serverDB, 'device-model-other-user');
      await other.register({ deviceId: 'shared-id', identitySource: 'machine-id' });

      await deviceModel.update('shared-id', { friendlyName: 'Mine' });

      const otherRow = await other.findByDeviceId('shared-id');
      expect(otherRow?.friendlyName).toBeNull();
    });
  });

  describe('delete', () => {
    it('should remove the row', async () => {
      await deviceModel.register({ deviceId: 'dev-1', identitySource: 'machine-id' });

      await deviceModel.delete('dev-1');

      const row = await deviceModel.findByDeviceId('dev-1');
      expect(row).toBeUndefined();
    });
  });
});
