// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, topics, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TrashModel } from '../trash';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'trash-coverage-user';
const workspaceId = 'trash-coverage-ws';

const cleanup = async () => {
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await serverDB.delete(users).where(eq(users.id, userId));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Trash coverage',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
});

afterEach(cleanup);

describe('TrashModel coverage', () => {
  describe('findPrivateIds', () => {
    it('returns an empty set for no ids in a workspace bin', async () => {
      const model = new TrashModel(serverDB, userId, workspaceId);
      await serverDB
        .insert(agents)
        .values({ id: 'trc-agent', userId, visibility: 'private', workspaceId });
      await serverDB
        .insert(topics)
        .values({ agentId: 'trc-agent', id: 'trc-topic', userId, workspaceId });
      const root = await model.register({
        deletedAt: new Date('2026-08-01T00:00:00Z'),
        root: { meta: {}, projectId: null, resourceId: 'trc-topic', resourceType: 'topic' },
      });

      expect(await model.findPrivateIds([root.id])).toEqual(new Set([root.id]));
      expect(await model.findPrivateIds([])).toEqual(new Set());
    });

    it('returns an empty set in a personal bin, which has no private side', async () => {
      const model = new TrashModel(serverDB, userId);
      await serverDB.insert(topics).values({ id: 'trc-personal-topic', userId });
      const root = await model.register({
        deletedAt: new Date('2026-08-01T00:00:00Z'),
        root: {
          meta: {},
          projectId: null,
          resourceId: 'trc-personal-topic',
          resourceType: 'topic',
        },
      });

      expect(await model.findById(root.id)).toBeDefined();
      expect(await model.findPrivateIds([root.id])).toEqual(new Set());
    });
  });
});
