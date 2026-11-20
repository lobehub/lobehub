// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { topicComments, topics, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { purgeExpiredTopicCommentModeration, TopicCommentModel } from '../topicComment';

const serverDB: LobeChatDatabase = await getTestDB();

const authorId = 'tcc-author';
const memberId = 'tcc-member';
const workspaceAId = 'tcc-ws-a';
const workspaceBId = 'tcc-ws-b';
const topicId = 'tcc-topic';

const authorModel = new TopicCommentModel(serverDB, authorId, workspaceAId);
const memberModel = new TopicCommentModel(serverDB, memberId, workspaceAId);

const cleanup = async () => {
  await serverDB.delete(workspaces).where(inArray(workspaces.id, [workspaceAId, workspaceBId]));
  await serverDB.delete(users).where(inArray(users.id, [authorId, memberId]));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: authorId }, { id: memberId }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceAId, name: 'TCC A', primaryOwnerId: authorId, slug: 'tcc-ws-a' },
    { id: workspaceBId, name: 'TCC B', primaryOwnerId: authorId, slug: 'tcc-ws-b' },
  ]);
  await serverDB
    .insert(topics)
    .values({ id: topicId, userId: authorId, workspaceId: workspaceAId });
});

afterEach(cleanup);

const findRow = async (id: string) => {
  const [row] = await serverDB.select().from(topicComments).where(eq(topicComments.id, id));
  return row;
};

describe('TopicCommentModel coverage', () => {
  describe('listThreads with a malformed cursor', () => {
    it.each([
      ['no separator', 'not-a-cursor'],
      ['separator first', '|tcc-root'],
      ['unparseable timestamp', 'yesterday|tcc-root'],
      ['missing id', '2026-01-01T00:00:00Z|'],
    ])('reads from the first page when the cursor has %s', async (_, cursor) => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'tcc-root',
        content: 'root',
        topicId,
      });

      const page = await authorModel.listThreads({ cursor, topicId });

      expect(page.items.map((item) => item.root.id)).toEqual([comment.id]);
    });
  });

  describe('createWithMentions', () => {
    it('fails when the idempotency key belongs to a row outside the workspace', async () => {
      // Same (topic, author, clientId) key, but stamped with another workspace — e.g. a row
      // left behind before the topic moved. The retry lookup is workspace scoped.
      await serverDB.insert(topicComments).values({
        authorUserId: authorId,
        clientId: 'tcc-retry',
        content: 'stale',
        topicId,
        workspaceId: workspaceBId,
      });

      await expect(
        authorModel.createWithMentions({ clientId: 'tcc-retry', content: 'retry', topicId }),
      ).rejects.toThrow('Failed to create topic comment');

      const rows = await serverDB
        .select()
        .from(topicComments)
        .where(eq(topicComments.topicId, topicId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ content: 'stale', workspaceId: workspaceBId });
    });
  });

  describe('delete', () => {
    it('refuses to delete a reply whose parent is not a thread root', async () => {
      const root = await authorModel.createWithMentions({
        clientId: 'tcc-root',
        content: 'root',
        topicId,
      });
      const reply = await authorModel.createWithMentions({
        clientId: 'tcc-reply',
        content: 'reply',
        parentCommentId: root.comment.id,
        topicId,
      });
      // The model never nests replies; a legacy / hand-written row may.
      const [nested] = await serverDB
        .insert(topicComments)
        .values({
          authorUserId: authorId,
          clientId: 'tcc-nested',
          content: 'nested',
          parentCommentId: reply.comment.id,
          topicId,
          workspaceId: workspaceAId,
        })
        .returning();

      expect(await authorModel.delete(nested.id)).toBe(false);
      expect(await findRow(nested.id)).toMatchObject({ content: 'nested', deletedAt: null });
    });
  });

  describe('purgeExpiredTopicCommentModeration', () => {
    const moderatedAt = new Date('2026-06-01T00:00:00Z');
    const afterExpiry = new Date('2026-07-02T00:00:00Z');

    it('hard-deletes an expired moderated reply and keeps its live root', async () => {
      const root = await authorModel.createWithMentions({
        clientId: 'tcc-root',
        content: 'root',
        topicId,
      });
      const reply = await memberModel.createWithMentions({
        clientId: 'tcc-reply',
        content: 'reply',
        parentCommentId: root.comment.id,
        topicId,
      });
      await authorModel.moderateRemove(reply.comment.id, moderatedAt);

      const result = await purgeExpiredTopicCommentModeration(serverDB, { now: afterExpiry });

      expect(result).toEqual({ garbageCollected: 0, hardDeleted: 1, processed: 1, tombstoned: 0 });
      expect(await findRow(reply.comment.id)).toBeUndefined();
      expect(await findRow(root.comment.id)).toMatchObject({ content: 'root', deletedAt: null });
    });

    it('collects the tombstoned root once its last moderated reply is purged', async () => {
      const root = await authorModel.createWithMentions({
        clientId: 'tcc-root',
        content: 'root',
        topicId,
      });
      const reply = await memberModel.createWithMentions({
        clientId: 'tcc-reply',
        content: 'reply',
        parentCommentId: root.comment.id,
        topicId,
      });
      expect(await authorModel.delete(root.comment.id)).toBe('soft');
      await authorModel.moderateRemove(reply.comment.id, moderatedAt);

      const result = await purgeExpiredTopicCommentModeration(serverDB, { now: afterExpiry });

      expect(result).toEqual({ garbageCollected: 1, hardDeleted: 1, processed: 1, tombstoned: 0 });
      expect(await findRow(reply.comment.id)).toBeUndefined();
      expect(await findRow(root.comment.id)).toBeUndefined();
    });
  });
});
