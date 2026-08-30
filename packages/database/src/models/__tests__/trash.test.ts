import { TRASH_RETENTION_MS } from '@lobechat/const';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { topics, trashItems, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TrashModel } from '../trash';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'trash-model-user';
const otherUserId = 'trash-model-other';
const workspaceId = 'trash-model-ws';

const model = new TrashModel(serverDB, userId);
const otherModel = new TrashModel(serverDB, otherUserId);

const at = (iso: string) => new Date(iso);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'ws', primaryOwnerId: userId, slug: workspaceId });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('TrashModel', () => {
  describe('register', () => {
    it('registers a root with children and stamps expiry from the retention window', async () => {
      const deletedAt = at('2026-08-01T00:00:00Z');
      const root = await model.register({
        children: [
          { resourceId: 'tpc_1', resourceType: 'topic', title: 'first' },
          { resourceId: 'tpc_2', resourceType: 'topic', title: 'second' },
        ],
        deletedAt,
        root: { meta: { childCount: 2 }, resourceId: 'agt_1', resourceType: 'agent', title: 'Bot' },
      });

      expect(root.rootId).toBeNull();
      expect(root.deletedByUserId).toBe(userId);
      expect(root.expiresAt.getTime()).toBe(deletedAt.getTime() + TRASH_RETENTION_MS);

      const children = await model.findChildren(root.id);
      expect(children.map((c) => c.resourceId).sort()).toEqual(['tpc_1', 'tpc_2']);
      expect(children.every((c) => c.rootId === root.id)).toBe(true);
    });

    it('is idempotent on the root resource and keeps a child that was trashed earlier on its own', async () => {
      // A topic trashed last week keeps its own root row when its agent is
      // trashed today: it was in the bin before the agent and must stay there
      // after the agent is restored.
      const topicRoot = await model.register({
        deletedAt: at('2026-08-01T00:00:00Z'),
        root: { resourceId: 'tpc_old', resourceType: 'topic', title: 'old' },
      });
      const agentRoot = await model.register({
        children: [
          { resourceId: 'tpc_old', resourceType: 'topic', title: 'old' },
          { resourceId: 'tpc_new', resourceType: 'topic', title: 'new' },
        ],
        deletedAt: at('2026-08-08T00:00:00Z'),
        root: { resourceId: 'agt_1', resourceType: 'agent', title: 'Bot' },
      });
      const again = await model.register({
        deletedAt: at('2026-08-09T00:00:00Z'),
        root: { resourceId: 'agt_1', resourceType: 'agent', title: 'Bot renamed' },
      });

      expect(again.id).toBe(agentRoot.id);
      expect(again.title).toBe('Bot renamed');

      const oldTopic = await model.findByResource('topic', 'tpc_old');
      expect(oldTopic?.id).toBe(topicRoot.id);
      expect(oldTopic?.rootId).toBeNull();

      const children = await model.findChildren(agentRoot.id);
      expect(children.map((c) => c.resourceId)).toEqual(['tpc_new']);
    });
  });

  describe('list / countByType', () => {
    it('lists roots only, newest first, scoped to the caller, with type filter and keyset paging', async () => {
      for (let i = 0; i < 5; i++) {
        await model.register({
          children: [{ resourceId: `child_${i}`, resourceType: 'topic' }],
          deletedAt: at(`2026-08-0${i + 1}T00:00:00Z`),
          root: { resourceId: `agt_${i}`, resourceType: 'agent', title: `agent ${i}` },
        });
      }
      await model.register({
        deletedAt: at('2026-08-09T00:00:00Z'),
        root: { resourceId: 'msg_1', resourceType: 'message', title: 'a message' },
      });
      await otherModel.register({
        deletedAt: at('2026-08-10T00:00:00Z'),
        root: { resourceId: 'agt_other', resourceType: 'agent', title: 'not mine' },
      });

      const first = await model.list({ limit: 3 });
      expect(first.items.map((i) => i.resourceId)).toEqual(['msg_1', 'agt_4', 'agt_3']);
      expect(first.nextCursor).toBeTruthy();

      const second = await model.list({ cursor: first.nextCursor, limit: 3 });
      expect(second.items.map((i) => i.resourceId)).toEqual(['agt_2', 'agt_1', 'agt_0']);
      expect(second.nextCursor).toBeNull();

      const agentsOnly = await model.list({ resourceType: 'agent' });
      expect(agentsOnly.items).toHaveLength(5);
      expect(agentsOnly.items.every((i) => i.rootId === null)).toBe(true);

      expect(await model.countByType()).toEqual({ agent: 5, message: 1 });
      expect(await otherModel.countByType()).toEqual({ agent: 1 });
    });

    it('scopes workspace listings to the workspace, not the caller', async () => {
      const wsModel = new TrashModel(serverDB, userId, workspaceId);
      const wsOther = new TrashModel(serverDB, otherUserId, workspaceId);
      await wsModel.register({
        deletedAt: at('2026-08-01T00:00:00Z'),
        root: { resourceId: 'tpc_ws', resourceType: 'topic', title: 'spec' },
      });
      await model.register({
        deletedAt: at('2026-08-02T00:00:00Z'),
        root: { resourceId: 'tpc_personal', resourceType: 'topic', title: 'mine' },
      });

      const seenByTeammate = await wsOther.list();
      expect(seenByTeammate.items.map((i) => i.resourceId)).toEqual(['tpc_ws']);
      expect((await model.list()).items.map((i) => i.resourceId)).toEqual(['tpc_personal']);
    });
  });

  describe('removeByIds', () => {
    it('drops the root and cascades its children', async () => {
      const root = await model.register({
        children: [{ resourceId: 'tpc_1', resourceType: 'topic' }],
        deletedAt: at('2026-08-01T00:00:00Z'),
        root: { resourceId: 'agt_1', resourceType: 'agent' },
      });
      await model.removeByIds([root.id]);
      expect(await serverDB.select().from(trashItems)).toHaveLength(0);
    });
  });

  describe('sweep helpers', () => {
    it('listExpiredRoots returns roots past their expiry across users, oldest first', async () => {
      const now = at('2026-09-15T00:00:00Z');
      await model.register({
        deletedAt: at('2026-08-01T00:00:00Z'), // expires 08-31
        root: { resourceId: 'agt_expired', resourceType: 'agent' },
      });
      await otherModel.register({
        deletedAt: at('2026-07-01T00:00:00Z'), // expires 07-31
        root: { resourceId: 'agt_older', resourceType: 'agent' },
      });
      await model.register({
        deletedAt: at('2026-09-10T00:00:00Z'), // not yet
        root: { resourceId: 'agt_fresh', resourceType: 'agent' },
      });

      const due = await TrashModel.listExpiredRoots(serverDB, { limit: 10, now });
      expect(due.map((r) => r.resourceId)).toEqual(['agt_older', 'agt_expired']);
    });

    it('pruneOrphans drops registry rows whose resource is gone or no longer stamped', async () => {
      const deletedAt = at('2026-08-01T00:00:00Z');
      await serverDB.insert(topics).values([
        { deletedAt, id: 'tpc_stamped', isDeleted: true, title: 'still trashed', userId },
        { id: 'tpc_live', title: 'restored elsewhere', userId },
      ]);
      await model.register({
        deletedAt,
        root: { resourceId: 'tpc_stamped', resourceType: 'topic' },
      });
      await model.register({ deletedAt, root: { resourceId: 'tpc_live', resourceType: 'topic' } });
      await model.register({ deletedAt, root: { resourceId: 'tpc_gone', resourceType: 'topic' } });

      const pruned = await TrashModel.pruneOrphans(serverDB);
      expect(pruned).toBe(2);
      const left = await serverDB.select().from(trashItems).where(eq(trashItems.userId, userId));
      expect(left.map((r) => r.resourceId)).toEqual(['tpc_stamped']);
    });
  });
});
