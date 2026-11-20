// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { TopicModel } from '../../../models/topic';
import { files, messageGroups, messages, messagesFiles, topics, users } from '../../../schemas';
import { TopicRepository } from '../index';

const serverDB = await getTestDB();
const userId = 'topic-repository-test-user';
const otherUserId = 'topic-repository-test-other-user';
const topicModel = new TopicModel(serverDB, userId);
const topicRepo = new TopicRepository(serverDB, userId);

/** @example Edit/resend copies a scoped ancestry and leaves the source unchanged. */
describe('TopicRepository', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  });
  afterEach(async () => {
    await serverDB.delete(users);
  });
  /** @example The edit boundary preserves its scoped source and copied context. */
  describe('branchAtMessage', () => {
    const seedConversation = async () => {
      const topic = await topicModel.create({
        metadata: {
          heteroEffort: 'high',
          heteroSessionId: 'codex-thread-source',
          runningOperation: {
            operationId: 'op-source',
            assistantMessageId: 'br-a2',
            startedAt: '2026-10-07T00:00:00Z',
          },
          workingDirectory: '/repo',
        },
        title: 'source',
      });
      const row = (id: string, role: string, content: string, parentId?: string) => ({
        content,
        id,
        parentId,
        role,
        topicId: topic.id,
        userId,
      });
      await serverDB
        .insert(messages)
        .values([
          row('br-u0', 'user', 'first question'),
          { ...row('br-a0', 'assistant', '', 'br-u0'), tools: [{ id: 'c1' }, { id: 'c2' }] },
          row('br-a0-old', 'assistant', 'superseded attempt', 'br-u0'),
          row('br-t1', 'tool', 'result one', 'br-a0'),
          row('br-t2', 'tool', 'result two', 'br-a0'),
          row('br-a1', 'assistant', 'first answer', 'br-t1'),
          row('br-u1', 'user', 'typo prompt', 'br-a1'),
          row('br-a2', 'assistant', 'reply to typo', 'br-u1'),
          row('br-u2', 'user', 'later turn', 'br-a2'),
        ]);
      await serverDB.insert(files).values({
        fileType: 'image/png',
        id: 'br-file',
        name: 'shot.png',
        size: 1,
        url: 'files/shot.png',
        userId,
      });
      await serverDB
        .insert(messagesFiles)
        .values({ fileId: 'br-file', messageId: 'br-u1', userId });
      return topic;
    };

    /** @example The edit boundary preserves its scoped source and copied context. */
    it('copies only the ancestry of the edited message into a fresh-session topic', async () => {
      const topic = await seedConversation();

      const result = await topicRepo.branchAtMessage(topic.id, 'br-u1', {
        content: 'fixed prompt',
        title: 'fixed prompt',
      });

      const copied = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.topicId, result!.topic.id));
      const byContent = new Map(copied.map((m) => [m.content, m]));
      // Later turns and the sibling attempt stay in the source.
      expect([...byContent.keys()].sort()).toEqual(
        ['', 'first answer', 'first question', 'fixed prompt', 'result one', 'result two'].sort(),
      );
      const edited = byContent.get('fixed prompt')!;
      expect(edited.id).toBe(result!.messageId);
      expect(edited.parentId).toBe(byContent.get('first answer')!.id);
      expect(byContent.get('result two')!.parentId).toBe(byContent.get('')!.id);

      const [link] = await serverDB
        .select()
        .from(messagesFiles)
        .where(eq(messagesFiles.messageId, edited.id));
      expect(link?.fileId).toBe('br-file');

      // Run configuration survives; the source's native session does not.
      // The marker is what lets the fresh local run replay the copied history.
      expect(result!.topic.metadata).toEqual({
        editedFrom: { messageId: 'br-u1', topicId: topic.id },
        heteroEffort: 'high',
        workingDirectory: '/repo',
      });
      expect(result!.topic.title).toBe('fixed prompt');

      const source = await serverDB.select().from(messages).where(eq(messages.topicId, topic.id));
      expect(source).toHaveLength(9);
      expect(source.find((m) => m.id === 'br-u1')?.content).toBe('typo prompt');
    });

    /** @example A retained nested message keeps its group ancestors; unrelated groups stay behind. */
    it('keeps the ancestor closure of referenced message groups', async () => {
      // ROOT CAUSE:
      // Pruning groups without directly attached messages deleted empty parents.
      // Their cascading foreign keys then deleted retained child groups/messages.
      const source = await topicModel.create({ title: 'nested groups' });
      await serverDB.insert(messageGroups).values([
        { id: 'nested-root', topicId: source.id, type: 'compression', userId },
        {
          id: 'nested-child',
          parentGroupId: 'nested-root',
          topicId: source.id,
          type: 'parallel',
          userId,
        },
        { id: 'unrelated-group', topicId: source.id, type: 'compression', userId },
      ]);
      await serverDB.insert(messages).values([
        {
          id: 'nested-history',
          content: 'retained history',
          messageGroupId: 'nested-child',
          role: 'assistant',
          topicId: source.id,
          userId,
        },
        {
          id: 'nested-edit',
          content: 'original',
          parentId: 'nested-history',
          role: 'user',
          topicId: source.id,
          userId,
        },
      ]);
      const result = await topicRepo.branchAtMessage(source.id, 'nested-edit', {
        content: 'edited',
      });
      const copied = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.topicId, result!.topic.id));
      /** @example Both the edited boundary and grouped ancestor survive the pruning transaction. */
      expect(copied.map((row) => row.content).sort()).toEqual(['edited', 'retained history']);
      const groups = await serverDB
        .select()
        .from(messageGroups)
        .where(eq(messageGroups.topicId, result!.topic.id));
      /** @example The empty root is retained, while the unrelated group is removed. */
      expect(groups).toHaveLength(2);
      const child = groups.find((group) => group.type === 'parallel')!;
      /** @example The copied child refers to its new root and the retained message refers to that child. */
      expect(child.parentGroupId).toBe(groups.find((group) => group.type === 'compression')!.id);
      /** @example Copying does not leave message references pointing into the source group tree. */
      expect(copied.find((row) => row.content === 'retained history')?.messageGroupId).toBe(
        child.id,
      );
      const originals = await serverDB
        .select()
        .from(messageGroups)
        .where(eq(messageGroups.topicId, source.id));
      /** @example Source groups are never pruned as a side effect of edit/resend. */
      expect(originals).toHaveLength(3);
    });

    /** @example An out-of-topic parent must never copy another user's message into this scope. */
    it('stops before an ancestor outside the authorized source topic', async () => {
      // ROOT CAUSE:
      // Adding an unknown parent ID before checking the source-topic map let
      // copyMessagesInDatabase read that message globally and change its owner.
      const foreign = await new TopicModel(serverDB, otherUserId).create({ title: 'private' });
      const source = await topicModel.create({ title: 'source' });
      await serverDB.insert(messages).values([
        {
          id: 'foreign-parent',
          content: 'private foreign content',
          role: 'user',
          topicId: foreign.id,
          userId: otherUserId,
        },
        {
          id: 'scoped-edit',
          content: 'original',
          role: 'user',
          parentId: 'foreign-parent',
          topicId: source.id,
          userId,
        },
      ]);
      const result = await topicRepo.branchAtMessage(source.id, 'scoped-edit', {
        content: 'edited',
      });
      const owned = await serverDB.select().from(messages).where(eq(messages.userId, userId));
      expect(owned.map((row) => row.content).sort()).toEqual(['edited', 'original']);
      expect(owned.find((row) => row.id === result!.messageId)?.parentId).toBeNull();
      const [original] = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, 'foreign-parent'));
      expect(original.userId).toBe(otherUserId);
      expect(original.topicId).toBe(foreign.id);
    });

    /** @example A rejected edited message rolls back the new topic and every copied row. */
    it('rolls back the topic and copied conversation when the final edit fails', async () => {
      const source = await seedConversation();
      // ROOT CAUSE:
      // Edit/resend writes two aggregates. Its transaction belongs in the
      // repository; splitting the writes would leave a topic after an edit error.
      await serverDB.execute(
        sql`ALTER TABLE messages ADD CONSTRAINT t647_reject_edit CHECK (content IS DISTINCT FROM 'reject edit')`,
      );
      try {
        await expect(
          topicRepo.branchAtMessage(source.id, 'br-u1', { content: 'reject edit' }),
        ).rejects.toThrow();
        expect(await serverDB.select().from(topics)).toHaveLength(1);
        const rows = await serverDB.select().from(messages);
        expect(rows).toHaveLength(9);
        expect(rows.find((row) => row.id === 'br-u1')?.content).toBe('typo prompt');
      } finally {
        await serverDB.execute(sql`ALTER TABLE messages DROP CONSTRAINT t647_reject_edit`);
      }
    });

    /** @example The edit boundary preserves its scoped source and copied context. */
    it('returns undefined unless the target is an accessible user message', async () => {
      const topic = await seedConversation();

      expect(await topicRepo.branchAtMessage(topic.id, 'br-a1', { content: 'x' })).toBeUndefined();
      expect(await topicRepo.branchAtMessage('nope', 'br-u1', { content: 'x' })).toBeUndefined();
      expect(
        await new TopicRepository(serverDB, otherUserId).branchAtMessage(topic.id, 'br-u1', {
          content: 'x',
        }),
      ).toBeUndefined();
    });
  });
});
