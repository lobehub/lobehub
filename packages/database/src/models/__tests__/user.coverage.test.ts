// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { messages, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AGENT_TRANSFER_PENDING_OWNER_DELETE, AgentTransferJobModel } from '../agentTransferJob';
import { UserModel } from '../user';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'user-coverage-user';
const otherUserId = 'user-coverage-other';
const createdUserIds: string[] = [];

const findUser = (id: string) => serverDB.query.users.findFirst({ where: eq(users.id, id) });

beforeEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB
    .delete(users)
    .where(inArray(users.id, [userId, otherUserId, ...createdUserIds.splice(0)]));
});

describe('UserModel coverage', () => {
  describe('missing user rows', () => {
    it('getUserActivitySummary reports nulls when the user row does not exist', async () => {
      const model = new UserModel(serverDB, 'user-coverage-missing');

      expect(await model.getUserActivitySummary()).toEqual({
        lastUserMessageAt: null,
        userCreatedAt: null,
      });
    });

    it('advanceLastActiveAt returns undefined when the user row does not exist', async () => {
      const model = new UserModel(serverDB, 'user-coverage-missing');

      expect(await model.advanceLastActiveAt(new Date())).toBeUndefined();
    });
  });

  describe('createUser', () => {
    it('skips the duplicate probe for an empty id and inserts straight away', async () => {
      // `users.id` has no default, so the only id that skips the probe is an empty one.
      createdUserIds.push('');
      const result = await UserModel.createUser(serverDB, {
        email: 'empty-id@example.com',
        id: '',
      });

      expect(result).toMatchObject({
        duplicate: false,
        user: { email: 'empty-id@example.com', id: '' },
      });
      expect(await findUser('')).toMatchObject({ email: 'empty-id@example.com' });
    });
  });

  describe('deleteUser', () => {
    it('rolls back when the final user delete itself runs past the transaction deadline', async () => {
      let elapsed = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => elapsed);
      const transaction = serverDB.transaction.bind(serverDB);
      vi.spyOn(serverDB, 'transaction').mockImplementation((callback) =>
        transaction(async (tx) => {
          const remove = tx.delete.bind(tx);
          // Every earlier cascade fits in the budget; the users row delete is slow.
          vi.spyOn(tx, 'delete').mockImplementation((table) => {
            if (table === users) elapsed += 1000;
            return remove(table);
          });
          return callback(tx);
        }),
      );

      await expect(
        UserModel.deleteUser(serverDB, userId, { transactionTimeoutMs: 100 }),
      ).rejects.toThrow('Account deletion transaction deadline exceeded');

      vi.restoreAllMocks();
      expect(await findUser(userId)).toBeDefined();
    });
  });

  describe('deleteUserInBatches', () => {
    it('rejects a batch size that is not a positive integer', async () => {
      await expect(
        UserModel.deleteUserInBatches(serverDB, userId, { batchSize: 0 }),
      ).rejects.toThrow('Account deletion batch size must be a positive integer');
      await expect(
        UserModel.deleteUserInBatches(serverDB, userId, { batchSize: 1.5 }),
      ).rejects.toThrow('Account deletion batch size must be a positive integer');

      expect(await findUser(userId)).toBeDefined();
    });

    it('refuses to start while an agent transfer touching the user is pending', async () => {
      vi.spyOn(AgentTransferJobModel, 'hasPendingJobTouchingUser').mockResolvedValue(true);

      await expect(UserModel.deleteUserInBatches(serverDB, userId)).rejects.toThrow(
        AGENT_TRANSFER_PENDING_OWNER_DELETE,
      );

      vi.restoreAllMocks();
      expect(await findUser(userId)).toBeDefined();
    });

    it('deletes empty topics and the user with the default batch size', async () => {
      await serverDB.insert(topics).values([
        { id: 'user-coverage-empty-topic', userId },
        { id: 'user-coverage-chatted-topic', userId },
      ]);
      await serverDB.insert(messages).values({
        content: 'hi',
        id: 'user-coverage-message',
        role: 'user',
        topicId: 'user-coverage-chatted-topic',
        userId,
      });

      await expect(UserModel.deleteUserInBatches(serverDB, userId)).resolves.toBe(true);

      expect(await findUser(userId)).toBeUndefined();
      expect(
        await serverDB.query.topics.findMany({ where: eq(topics.userId, userId) }),
      ).toHaveLength(0);
    });

    it('stops before the final cascade when asked to after the batches drained', async () => {
      await serverDB.insert(topics).values({ id: 'user-coverage-drained-topic', userId });
      // Polled before the topicless pass, before each topic batch (one with a topic, one
      // that finds none), then once more before the final cascade.
      let checks = 0;

      await expect(
        UserModel.deleteUserInBatches(serverDB, userId, { shouldContinue: () => ++checks <= 3 }),
      ).resolves.toBe(false);

      expect(checks).toBe(4);
      expect(
        await serverDB.query.topics.findMany({ where: eq(topics.userId, userId) }),
      ).toHaveLength(0);
      expect(await findUser(userId)).toBeDefined();
    });
  });

  describe('findByIds', () => {
    it('returns an empty list for no ids', async () => {
      expect(await UserModel.findByIds(serverDB, [])).toEqual([]);
    });

    it('returns only the requested users', async () => {
      const rows = await UserModel.findByIds(serverDB, [userId, 'user-coverage-missing']);

      expect(rows.map((row) => row.id)).toEqual([userId]);
    });
  });

  describe('listUsersForHourlyMemoryExtractor', () => {
    it('applies the limit when one is given', async () => {
      await serverDB.insert(topics).values([
        { id: 'user-coverage-hourly-a', userId },
        { id: 'user-coverage-hourly-b', userId: otherUserId },
      ]);
      await serverDB.insert(messages).values([
        {
          content: 'a',
          id: 'user-coverage-hourly-msg-a',
          role: 'user',
          topicId: 'user-coverage-hourly-a',
          userId,
        },
        {
          content: 'b',
          id: 'user-coverage-hourly-msg-b',
          role: 'user',
          topicId: 'user-coverage-hourly-b',
          userId: otherUserId,
        },
      ]);
      const whitelist = [userId, otherUserId];

      const all = await UserModel.listUsersForHourlyMemoryExtractor(serverDB, { whitelist });
      const limited = await UserModel.listUsersForHourlyMemoryExtractor(serverDB, {
        limit: 1,
        whitelist,
      });

      expect(all).toHaveLength(2);
      expect(limited.map((row) => row.id)).toEqual([all[0].id]);
    });
  });
});
