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

  describe('findRootsByResources', () => {
    it('returns only the registered roots of one kind for the given resource ids', async () => {
      const model = new TrashModel(serverDB, userId, workspaceId);
      await serverDB
        .insert(agents)
        .values({ id: 'trc-roots-agent', userId, visibility: 'public', workspaceId });

      const root = await model.register({
        children: [
          { meta: {}, projectId: null, resourceId: 'trc-roots-topic', resourceType: 'topic' },
        ],
        deletedAt: new Date('2026-08-01T00:00:00Z'),
        root: {
          meta: {},
          projectId: null,
          resourceId: 'trc-roots-agent',
          resourceType: 'agent',
        },
      });

      // The cascaded child carries a `rootId`, so it never matches as a root.
      expect(
        (await model.findRootsByResources('agent', ['trc-roots-agent', 'trc-roots-topic'])).map(
          (row) => row.id,
        ),
      ).toEqual([root.id]);
      // Another kind with the same ids resolves to nothing.
      expect(await model.findRootsByResources('topic', ['trc-roots-agent'])).toEqual([]);
      expect(await model.findRootsByResources('agent', [])).toEqual([]);
    });

    it('stays inside the bin scope it was opened on', async () => {
      const otherWorkspace = 'trash-coverage-ws-2';
      await serverDB.insert(workspaces).values({
        id: otherWorkspace,
        name: 'Trash coverage 2',
        primaryOwnerId: userId,
        slug: otherWorkspace,
      });
      const mine = new TrashModel(serverDB, userId, workspaceId);
      const theirs = new TrashModel(serverDB, userId, otherWorkspace);

      await mine.register({
        deletedAt: new Date('2026-08-01T00:00:00Z'),
        root: { meta: {}, projectId: null, resourceId: 'trc-scope-task', resourceType: 'task' },
      });

      expect(await theirs.findRootsByResources('task', ['trc-scope-task'])).toEqual([]);
      expect(await mine.findRootsByResources('task', ['trc-scope-task'])).toHaveLength(1);
    });
  });
});
