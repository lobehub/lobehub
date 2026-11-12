import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { messages, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { UserModel } from '../user';

const serverDB: LobeChatDatabase = await getTestDB();

// Postgres keeps microseconds; a cursor built from a returned row is a JS Date, which keeps only
// milliseconds. These rows sit inside one millisecond on purpose.
const insertMicrosecondUsers = async (ids: string[]) => {
  await serverDB.delete(users);
  for (const [index, id] of ids.entries()) {
    await serverDB.insert(users).values({ id });
    await serverDB.execute(
      sql`UPDATE ${users} SET created_at = ${`2025-05-12T22:25:44.64952${index}Z`}::timestamptz WHERE id = ${id}`,
    );
  }
};

describe('UserModel memory extractor cursor precision', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
  });

  it('does not return the cursor row again when created_at has microseconds', async () => {
    await insertMicrosecondUsers(['user-a']);

    const page1 = await UserModel.listUsersForMemoryExtractor(serverDB, { limit: 1 });
    expect(page1.map((u) => u.id)).toEqual(['user-a']);

    const page2 = await UserModel.listUsersForMemoryExtractor(serverDB, {
      cursor: { createdAt: page1[0].createdAt, id: page1[0].id },
      limit: 10,
    });
    expect(page2).toEqual([]);
  });

  it('ends the hourly pagination after the last user instead of repeating it', async () => {
    await insertMicrosecondUsers(['user-a']);
    await serverDB.insert(topics).values({ id: 'topic-a', userId: 'user-a' });
    await serverDB
      .insert(messages)
      .values({ id: 'msg-a', role: 'user', topicId: 'topic-a', userId: 'user-a' });

    const page1 = await UserModel.listUsersForHourlyMemoryExtractor(serverDB, { limit: 200 });
    expect(page1.map((u) => u.id)).toEqual(['user-a']);

    const page2 = await UserModel.listUsersForHourlyMemoryExtractor(serverDB, {
      cursor: { createdAt: page1[0].createdAt, id: page1[0].id },
      limit: 200,
    });
    expect(page2).toEqual([]);
  });

  it('accepts a cursor whose createdAt crossed a workflow boundary as an ISO string', async () => {
    await insertMicrosecondUsers(['user-a']);

    const page1 = await UserModel.listUsersForMemoryExtractor(serverDB, { limit: 1 });
    const cursor = {
      createdAt: new Date(page1[0].createdAt).toISOString() as unknown as Date,
      id: page1[0].id,
    };

    expect(await UserModel.listUsersForMemoryExtractor(serverDB, { cursor })).toEqual([]);
  });

  it('pages through users inside the same millisecond by id without skipping any', async () => {
    await insertMicrosecondUsers(['user-c', 'user-a', 'user-b']);

    const seen: string[] = [];
    let cursor: { createdAt: Date; id: string } | undefined;
    for (let page = 0; page < 5; page++) {
      const rows = await UserModel.listUsersForMemoryExtractor(serverDB, { cursor, limit: 1 });
      if (rows.length === 0) break;
      seen.push(...rows.map((u) => u.id));
      cursor = { createdAt: rows.at(-1)!.createdAt, id: rows.at(-1)!.id };
    }

    expect(seen).toEqual(['user-a', 'user-b', 'user-c']);
  });
});
