import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, messagePlugins, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

/**
 * `guardShareProvenance` walls the generic message surface off from Agent
 * Share conversations — see `MessageModelOptions.guardShareProvenance`.
 * `visitorId` owns the share conversation rows; `creatorId` owns the agent.
 */
const visitorId = 'share-guard-visitor';
const creatorId = 'share-guard-creator';
const agentId = 'share-guard-agent';
const shareId = '00000000-0000-4000-8000-000000000001';

const guardedModel = new MessageModel(serverDB, visitorId, undefined, {
  guardShareProvenance: true,
});
const internalModel = new MessageModel(serverDB, visitorId);

beforeEach(async () => {
  await serverDB.transaction(async (trx) => {
    await trx.delete(users).where(eq(users.id, visitorId));
    await trx.delete(users).where(eq(users.id, creatorId));
    await trx.insert(users).values([{ id: visitorId }, { id: creatorId }]);
    await trx.insert(agents).values({ id: agentId, title: 'Shared', userId: creatorId });
    await trx.insert(topics).values([
      { agentId, id: 'share-topic', shareId, title: 'Share', userId: visitorId },
      { id: 'plain-topic', title: 'Plain', userId: visitorId },
    ]);
    await trx.insert(messages).values([
      { content: 'turn', id: 'share-msg', role: 'user', topicId: 'share-topic', userId: visitorId },
      { content: 'chat', id: 'plain-msg', role: 'user', topicId: 'plain-topic', userId: visitorId },
    ]);
  });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, visitorId));
  await serverDB.delete(users).where(eq(users.id, creatorId));
});

describe('MessageModel guardShareProvenance', () => {
  describe('create', () => {
    it('refuses to create a message inside a share topic', async () => {
      await expect(
        guardedModel.create({ content: 'injected', role: 'user', topicId: 'share-topic' }),
      ).rejects.toThrow(/belongs to an agent share/);
    });

    it('still creates into ordinary topics', async () => {
      const item = await guardedModel.create({
        content: 'fine',
        role: 'user',
        topicId: 'plain-topic',
      });
      expect(item.topicId).toBe('plain-topic');
    });
  });

  describe('update', () => {
    it('refuses a content patch on a share row', async () => {
      await expect(guardedModel.update('share-msg', { content: 'x'.repeat(10) })).rejects.toThrow(
        /belongs to an agent share/,
      );

      const [row] = await serverDB.select().from(messages).where(eq(messages.id, 'share-msg'));
      expect(row.content).toBe('turn');
    });

    it('allows the error-only patch the share client persists run failures with', async () => {
      const result = await guardedModel.update('share-msg', {
        error: { body: {}, message: 'run failed', type: 'PluginServerError' } as any,
      });
      expect(result.success).toBe(true);

      const [row] = await serverDB.select().from(messages).where(eq(messages.id, 'share-msg'));
      expect(row.error).toMatchObject({ message: 'run failed' });
    });

    it('still patches ordinary rows', async () => {
      const result = await guardedModel.update('plain-msg', { content: 'edited' });
      expect(result.success).toBe(true);
    });

    it('refuses updateToolMessage on a share row — the batchMutate bypass', async () => {
      await expect(
        guardedModel.updateToolMessage('share-msg', { content: 'x'.repeat(10) }),
      ).rejects.toThrow(/belongs to an agent share/);

      const [row] = await serverDB.select().from(messages).where(eq(messages.id, 'share-msg'));
      expect(row.content).toBe('turn');
    });

    it('still runs updateToolMessage on ordinary rows', async () => {
      const result = await guardedModel.updateToolMessage('plain-msg', { content: 'tooled' });
      expect(result.success).toBe(true);
    });

    it('refuses updateMessagePlugin and updateToolArguments on share rows', async () => {
      await serverDB.insert(messages).values([
        {
          content: '',
          id: 'share-parent',
          role: 'assistant',
          tools: [{ apiName: 'run', arguments: '{}', id: 'tc-1', identifier: 'tool' }],
          topicId: 'share-topic',
          userId: visitorId,
        },
        {
          content: 'result',
          id: 'share-tool',
          parentId: 'share-parent',
          role: 'tool',
          topicId: 'share-topic',
          userId: visitorId,
        },
      ]);
      await serverDB
        .insert(messagePlugins)
        .values({ id: 'share-tool', toolCallId: 'tc-1', userId: visitorId });

      await expect(
        guardedModel.updateMessagePlugin('share-tool', { arguments: 'x'.repeat(10) }),
      ).rejects.toThrow(/belongs to an agent share/);
      await expect(guardedModel.updateToolArguments('tc-1', 'x'.repeat(10))).rejects.toThrow(
        /belongs to an agent share/,
      );
    });
  });

  describe('deletes', () => {
    it('refuses deleteMessage on a share row, keeping the turn count intact', async () => {
      await expect(guardedModel.deleteMessage('share-msg')).rejects.toThrow(
        /belongs to an agent share/,
      );

      const rows = await serverDB.select().from(messages).where(eq(messages.id, 'share-msg'));
      expect(rows).toHaveLength(1);
    });

    it('refuses deleteMessages when any target is a share row', async () => {
      await expect(guardedModel.deleteMessages(['plain-msg', 'share-msg'])).rejects.toThrow(
        /belongs to an agent share/,
      );

      // The transaction rolled back — the ordinary row survives too.
      const rows = await serverDB.select().from(messages);
      expect(rows).toHaveLength(2);
    });

    it('excludes share rows from bulk sweeps instead of failing them', async () => {
      await guardedModel.deleteAllMessages();

      const rows = await serverDB.select().from(messages);
      expect(rows.map((row) => row.id)).toEqual(['share-msg']);
    });

    it('leaves internal (unguarded) writers untouched', async () => {
      await internalModel.deleteMessage('share-msg');

      const rows = await serverDB.select().from(messages).where(eq(messages.id, 'share-msg'));
      expect(rows).toHaveLength(0);
    });
  });
});
