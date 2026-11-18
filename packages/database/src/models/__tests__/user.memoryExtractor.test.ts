import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { messages, topics, users, userSettings } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import type { ListUsersForMemoryExtractorCursor } from '../user';
import { UserModel } from '../user';

const serverDB: LobeChatDatabase = await getTestDB();

/**
 * Gives the users the same millisecond but different microseconds, as rows written by SQL
 * defaults (`now()`) or a bulk import do; a cursor only carries milliseconds through a JS Date.
 */
const setSubMillisecondCreatedAt = async (micros: Record<string, string>) => {
  for (const [id, fraction] of Object.entries(micros)) {
    await serverDB.execute(
      sql`UPDATE ${users} SET created_at = ${`2026-11-17T10:29:19.${fraction}Z`}::timestamptz WHERE id = ${id}`,
    );
  }
};

/** Follows the cursor page by page, the way the memory workflows do, and returns every id listed. */
const walkUserPages = async (
  list: (cursor?: ListUsersForMemoryExtractorCursor) => Promise<{ createdAt: Date; id: string }[]>,
) => {
  const seen: string[] = [];
  let cursor: ListUsersForMemoryExtractorCursor | undefined;
  for (let page = 0; page < 10; page++) {
    const rows = await list(cursor);
    if (rows.length === 0) break;
    seen.push(...rows.map((row) => row.id));
    const last = rows.at(-1)!;
    cursor = { createdAt: last.createdAt, id: last.id };
  }
  return seen;
};

describe('UserModel memory extractor listings', () => {
  afterEach(async () => {
    await serverDB.delete(users);
  });

  describe('listUsersForMemoryExtractor', () => {
    it('should paginate users by createdAt and id', async () => {
      await serverDB.delete(users);
      await serverDB.insert(users).values([
        { id: 'u1', createdAt: new Date('2024-01-01T00:00:00Z') },
        { id: 'u2', createdAt: new Date('2024-01-02T00:00:00Z') },
        { id: 'u3', createdAt: new Date('2024-01-03T00:00:00Z') },
      ]);

      const page1 = await UserModel.listUsersForMemoryExtractor(serverDB, { limit: 1 });
      expect(page1.map((u) => u.id)).toEqual(['u1']);

      const cursor: ListUsersForMemoryExtractorCursor = {
        createdAt: page1[0].createdAt,
        id: page1[0].id,
      };

      const page2 = await UserModel.listUsersForMemoryExtractor(serverDB, { cursor, limit: 10 });
      expect(page2.map((u) => u.id)).toEqual(['u2', 'u3']);
    });

    it('pages through users sharing a millisecond without repeating or skipping any', async () => {
      await serverDB.delete(users);
      await serverDB.insert(users).values([{ id: 'u-z' }, { id: 'u-a' }, { id: 'u-m' }]);
      await setSubMillisecondCreatedAt({ 'u-a': '001900', 'u-m': '001290', 'u-z': '001200' });

      const seen = await walkUserPages((cursor) =>
        UserModel.listUsersForMemoryExtractor(serverDB, { cursor, limit: 1 }),
      );

      expect(seen).toEqual(['u-a', 'u-m', 'u-z']);
    });

    it('should filter by whitelist when provided', async () => {
      await serverDB.delete(users);
      await serverDB.insert(users).values([
        { id: 'user-a', createdAt: new Date('2024-01-01T00:00:00Z') },
        { id: 'user-b', createdAt: new Date('2024-01-02T00:00:00Z') },
        { id: 'user-c', createdAt: new Date('2024-01-03T00:00:00Z') },
        { id: 'user-d', createdAt: new Date('2024-01-04T00:00:00Z') },
      ]);

      const result = await UserModel.listUsersForMemoryExtractor(serverDB, {
        whitelist: ['user-b', 'user-d'],
      });

      expect(result.map((u) => u.id)).toEqual(['user-b', 'user-d']);
    });

    it('should combine whitelist with cursor', async () => {
      await serverDB.delete(users);
      await serverDB.insert(users).values([
        { id: 'user-a', createdAt: new Date('2024-01-01T00:00:00Z') },
        { id: 'user-b', createdAt: new Date('2024-01-02T00:00:00Z') },
        { id: 'user-c', createdAt: new Date('2024-01-03T00:00:00Z') },
        { id: 'user-d', createdAt: new Date('2024-01-04T00:00:00Z') },
      ]);

      const result = await UserModel.listUsersForMemoryExtractor(serverDB, {
        cursor: { createdAt: new Date('2024-01-02T00:00:00Z'), id: 'user-b' },
        whitelist: ['user-a', 'user-c', 'user-d'],
      });

      // Only users in whitelist that are after cursor
      expect(result.map((u) => u.id)).toEqual(['user-c', 'user-d']);
    });

    it('should return all users when whitelist is empty array', async () => {
      await serverDB.delete(users);
      await serverDB.insert(users).values([
        { id: 'user-1', createdAt: new Date('2024-01-01T00:00:00Z') },
        { id: 'user-2', createdAt: new Date('2024-01-02T00:00:00Z') },
      ]);

      const result = await UserModel.listUsersForMemoryExtractor(serverDB, {
        whitelist: [],
      });

      // Empty whitelist should not filter (same as no whitelist)
      expect(result.map((u) => u.id)).toEqual(['user-1', 'user-2']);
    });
  });

  describe('listUsersForHourlyMemoryExtractor', () => {
    it('should return only users with memory enabled and at least one chatted topic', async () => {
      await serverDB.delete(users);
      await serverDB.insert(users).values([
        { id: 'u1', createdAt: new Date('2024-01-01T00:00:00Z') }, // no settings => enabled
        { id: 'u2', createdAt: new Date('2024-01-02T00:00:00Z') }, // memory disabled
        { id: 'u3', createdAt: new Date('2024-01-03T00:00:00Z') }, // no messages
        { id: 'u4', createdAt: new Date('2024-01-04T00:00:00Z') }, // assistant-only messages
        { id: 'u5', createdAt: new Date('2024-01-05T00:00:00Z') }, // enabled + chatted
      ]);

      await serverDB.insert(userSettings).values([
        { id: 'u2', memory: { enabled: false } },
        { id: 'u3', memory: { enabled: true } },
        { id: 'u4', memory: { enabled: true } },
        { id: 'u5', memory: { enabled: true } },
      ]);

      await serverDB.insert(topics).values([
        { id: 't1', userId: 'u1' },
        { id: 't2', userId: 'u2' },
        { id: 't3', userId: 'u3' },
        { id: 't4', userId: 'u4' },
        { id: 't5', userId: 'u5' },
      ]);

      await serverDB.insert(messages).values([
        { id: 'm1', role: 'user', topicId: 't1', userId: 'u1' },
        { id: 'm2', role: 'user', topicId: 't2', userId: 'u2' },
        { id: 'm4', role: 'assistant', topicId: 't4', userId: 'u4' },
        { id: 'm5', role: 'user', topicId: 't5', userId: 'u5' },
      ]);

      const result = await UserModel.listUsersForHourlyMemoryExtractor(serverDB);

      expect(result.map((u) => u.id)).toEqual(['u1', 'u5']);
    });

    it('should support whitelist and cursor pagination', async () => {
      await serverDB.delete(users);
      await serverDB.insert(users).values([
        { id: 'user-a', createdAt: new Date('2024-01-01T00:00:00Z') },
        { id: 'user-b', createdAt: new Date('2024-01-02T00:00:00Z') },
        { id: 'user-c', createdAt: new Date('2024-01-03T00:00:00Z') },
      ]);

      await serverDB.insert(topics).values([
        { id: 'topic-a', userId: 'user-a' },
        { id: 'topic-b', userId: 'user-b' },
        { id: 'topic-c', userId: 'user-c' },
      ]);

      await serverDB.insert(messages).values([
        { id: 'msg-a', role: 'user', topicId: 'topic-a', userId: 'user-a' },
        { id: 'msg-b', role: 'user', topicId: 'topic-b', userId: 'user-b' },
        { id: 'msg-c', role: 'user', topicId: 'topic-c', userId: 'user-c' },
      ]);

      const result = await UserModel.listUsersForHourlyMemoryExtractor(serverDB, {
        cursor: { createdAt: new Date('2024-01-02T00:00:00Z'), id: 'user-b' },
        whitelist: ['user-a', 'user-c'],
      });

      expect(result.map((u) => u.id)).toEqual(['user-c']);
    });

    it('pages through users sharing a millisecond without repeating or skipping any', async () => {
      await serverDB.delete(users);
      const ids = ['u-z', 'u-a', 'u-m'];
      await serverDB.insert(users).values(ids.map((id) => ({ id })));
      await serverDB.insert(topics).values(ids.map((id) => ({ id: `t-${id}`, userId: id })));
      await serverDB
        .insert(messages)
        .values(ids.map((id) => ({ id: `m-${id}`, role: 'user', topicId: `t-${id}`, userId: id })));
      await setSubMillisecondCreatedAt({ 'u-a': '001900', 'u-m': '001290', 'u-z': '001200' });

      const seen = await walkUserPages((cursor) =>
        UserModel.listUsersForHourlyMemoryExtractor(serverDB, { cursor, limit: 1 }),
      );

      expect(seen).toEqual(['u-a', 'u-m', 'u-z']);
    });
  });
});
