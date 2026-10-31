// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, chatGroups, sessionGroups, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { SessionGroupModel } from '../sessionGroup';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'session-group-coverage-user';
const workspaceId = 'session-group-coverage-ws';
const model = new SessionGroupModel(serverDB, userId, workspaceId);

const cleanup = async () => {
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await serverDB.delete(users).where(eq(users.id, userId));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Session group coverage',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
});

afterEach(cleanup);

const findGroup = (id: string) =>
  serverDB.query.sessionGroups.findFirst({ where: eq(sessionGroups.id, id) });

describe('SessionGroupModel coverage', () => {
  describe('publishToWorkspace', () => {
    it('refuses to publish a folder that still holds a private agent', async () => {
      const folder = await model.create({ name: 'Mixed', visibility: 'private' });
      await serverDB.insert(agents).values({
        id: 'sgc-private-agent',
        sessionGroupId: folder.id,
        userId,
        visibility: 'private',
        workspaceId,
      });

      await expect(model.publishToWorkspace(folder.id)).rejects.toThrow(
        'Move or publish the private items inside this folder before sharing it with the workspace',
      );
      expect((await findGroup(folder.id))?.visibility).toBe('private');
    });

    it('refuses to publish a folder that still holds a private chat group', async () => {
      const folder = await model.create({ name: 'Mixed groups', visibility: 'private' });
      await serverDB.insert(chatGroups).values({
        groupId: folder.id,
        id: 'sgc-private-chat-group',
        userId,
        visibility: 'private',
        workspaceId,
      });

      await expect(model.publishToWorkspace(folder.id)).rejects.toThrow(
        'Move or publish the private items inside this folder before sharing it with the workspace',
      );
      expect((await findGroup(folder.id))?.visibility).toBe('private');
    });
  });
});
