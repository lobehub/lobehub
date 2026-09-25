// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { acceptanceInstalls, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AcceptanceInstallModel } from '../acceptanceInstall';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'acceptance-install-model-test-user';
const otherUserId = 'acceptance-install-model-other-user';
const workspaceId = 'acceptance-install-model-test-workspace';

const acceptanceInstallModel = new AcceptanceInstallModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(acceptanceInstalls);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Test Workspace',
    slug: 'acceptance-install-test',
    primaryOwnerId: userId,
  });
});

afterEach(async () => {
  await serverDB.delete(acceptanceInstalls);
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await serverDB.delete(users);
});

describe('AcceptanceInstallModel', () => {
  describe('record', () => {
    it('records an install event attributed to the user', async () => {
      const row = await acceptanceInstallModel.record({
        event: 'install',
        version: '0.5.0',
      });

      expect(row.id).toBeDefined();
      expect(row).toMatchObject({
        event: 'install',
        userId,
        version: '0.5.0',
        workspaceId: null,
      });

      const [persisted] = await serverDB
        .select()
        .from(acceptanceInstalls)
        .where(eq(acceptanceInstalls.id, row.id));
      expect(persisted).toMatchObject({ event: 'install', userId, version: '0.5.0' });
    });

    it('records an update event with the workspace the install ran under', async () => {
      const workspaceModel = new AcceptanceInstallModel(serverDB, userId, workspaceId);

      const row = await workspaceModel.record({ event: 'update' });

      expect(row).toMatchObject({
        event: 'update',
        userId,
        version: null,
        workspaceId,
      });
    });

    it('keeps every event instead of deduplicating repeated installs', async () => {
      await acceptanceInstallModel.record({ event: 'install' });
      await acceptanceInstallModel.record({ event: 'install' });
      await new AcceptanceInstallModel(serverDB, otherUserId).record({
        event: 'install',
      });

      const rows = await serverDB.select().from(acceptanceInstalls);
      expect(rows).toHaveLength(3);
      expect(rows.filter((row) => row.userId === userId)).toHaveLength(2);
    });

    it('preserves event totals but clears attribution when the workspace and user are deleted', async () => {
      const row = await new AcceptanceInstallModel(serverDB, userId, workspaceId).record({
        event: 'install',
      });

      await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));

      const [afterWorkspaceDeletion] = await serverDB
        .select()
        .from(acceptanceInstalls)
        .where(eq(acceptanceInstalls.id, row.id));
      expect(afterWorkspaceDeletion).toMatchObject({ userId, workspaceId: null });

      await serverDB.delete(users).where(eq(users.id, userId));

      const remaining = await serverDB
        .select()
        .from(acceptanceInstalls)
        .where(eq(acceptanceInstalls.id, row.id));
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({
        event: 'install',
        userId: null,
        workspaceId: null,
      });
    });
  });
});
