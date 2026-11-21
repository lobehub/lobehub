// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { userMemories, userMemoriesContexts, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { buildUserMemoryWhere } from '../where';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'user-memory-where-legacy-user';

/**
 * The pre-parent shape of a context row: only the legacy `user_memory_ids` list,
 * no single `user_memory_id` and no soft-delete column of its own. Contexts still
 * carry both while rows migrate, so the helper has to judge the list on its own.
 */
const legacyShape = {
  userId: userMemoriesContexts.userId,
  userMemoryIds: userMemoriesContexts.userMemoryIds,
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });

  const [live] = await serverDB
    .insert(userMemories)
    .values({ lastAccessedAt: new Date(), summary: 'live', userId })
    .returning();
  const [trashed] = await serverDB
    .insert(userMemories)
    .values({ isDeleted: true, lastAccessedAt: new Date(), summary: 'trashed', userId })
    .returning();

  await serverDB.insert(userMemoriesContexts).values([
    { id: 'legacy-live', userId, userMemoryIds: [live.id] },
    { id: 'legacy-trashed', userId, userMemoryIds: [trashed.id] },
    { id: 'legacy-standalone', userId, userMemoryIds: [] },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('buildUserMemoryWhere on a legacy id-list-only child', () => {
  it('keeps rows whose listed memories are live and drops the rest', async () => {
    const rows = await serverDB
      .select({ id: userMemoriesContexts.id })
      .from(userMemoriesContexts)
      .where(buildUserMemoryWhere(serverDB, userId, legacyShape));

    // Standalone rows (empty list) stay: they reference nothing that was trashed.
    expect(rows.map((row) => row.id).sort()).toEqual(['legacy-live', 'legacy-standalone']);
  });
});
