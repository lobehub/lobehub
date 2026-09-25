// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { skillInstalls, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { SkillInstallModel } from '../skillInstall';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'skill-install-model-test-user';
const otherUserId = 'skill-install-model-other-user';
const workspaceId = 'skill-install-model-test-workspace';

const skillInstallModel = new SkillInstallModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(skillInstalls);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Test Workspace',
    slug: 'skill-install-test',
    primaryOwnerId: userId,
  });
});

afterEach(async () => {
  await serverDB.delete(skillInstalls);
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await serverDB.delete(users);
});

describe('SkillInstallModel', () => {
  describe('record', () => {
    it('records an install event attributed to the user', async () => {
      const row = await skillInstallModel.record({
        event: 'install',
        identifier: 'acceptance',
        version: '0.5.0',
      });

      expect(row.id).toBeDefined();
      expect(row).toMatchObject({
        event: 'install',
        identifier: 'acceptance',
        userId,
        version: '0.5.0',
        workspaceId: null,
      });

      const [persisted] = await serverDB
        .select()
        .from(skillInstalls)
        .where(eq(skillInstalls.id, row.id));
      expect(persisted).toMatchObject({ event: 'install', identifier: 'acceptance', userId });
    });

    it('records an update event with the workspace the install ran under', async () => {
      const workspaceModel = new SkillInstallModel(serverDB, userId, workspaceId);

      const row = await workspaceModel.record({ event: 'update', identifier: 'acceptance' });

      expect(row).toMatchObject({
        event: 'update',
        identifier: 'acceptance',
        userId,
        version: null,
        workspaceId,
      });
    });

    it('keeps every event instead of deduplicating repeated installs', async () => {
      await skillInstallModel.record({ event: 'install', identifier: 'acceptance' });
      await skillInstallModel.record({ event: 'install', identifier: 'acceptance' });
      await new SkillInstallModel(serverDB, otherUserId).record({
        event: 'install',
        identifier: 'acceptance',
      });

      const rows = await serverDB
        .select()
        .from(skillInstalls)
        .where(eq(skillInstalls.identifier, 'acceptance'));
      expect(rows).toHaveLength(3);
      expect(rows.filter((row) => row.userId === userId)).toHaveLength(2);
    });

    it('preserves event totals but clears attribution when the workspace and user are deleted', async () => {
      const row = await new SkillInstallModel(serverDB, userId, workspaceId).record({
        event: 'install',
        identifier: 'acceptance',
      });

      await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));

      const [afterWorkspaceDeletion] = await serverDB
        .select()
        .from(skillInstalls)
        .where(eq(skillInstalls.id, row.id));
      expect(afterWorkspaceDeletion).toMatchObject({ userId, workspaceId: null });

      await serverDB.delete(users).where(eq(users.id, userId));

      const remaining = await serverDB
        .select()
        .from(skillInstalls)
        .where(eq(skillInstalls.id, row.id));
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({
        event: 'install',
        identifier: 'acceptance',
        userId: null,
        workspaceId: null,
      });
    });
  });
});
