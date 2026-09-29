import { and, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';

import { userMemories } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { notTrashed } from '../../utils/softDelete';

const liveUserMemories = alias(userMemories, 'live_user_memories');

interface UserMemoryScopedTable {
  isDeleted?: AnyPgColumn;
  userId: AnyPgColumn;
  userMemoryId?: AnyPgColumn;
  userMemoryIds?: AnyPgColumn;
}

const liveMemoryIds = (db: LobeChatDatabase, userId: string) =>
  db
    .select({ id: liveUserMemories.id })
    .from(liveUserMemories)
    .where(and(eq(liveUserMemories.userId, userId), notTrashed(liveUserMemories.isDeleted)));

const liveParentMemory = (db: LobeChatDatabase, userId: string, userMemoryId: AnyPgColumn): SQL =>
  or(isNull(userMemoryId), inArray(userMemoryId, liveMemoryIds(db, userId))) as SQL;

const liveContextMemory = (db: LobeChatDatabase, userId: string, userMemoryIds: AnyPgColumn): SQL =>
  or(
    isNull(userMemoryIds),
    sql`jsonb_array_length(${userMemoryIds}) = 0`,
    sql`${userMemoryIds} ?| ARRAY(${liveMemoryIds(db, userId)})`,
  ) as SQL;

/** User memories have no workspace column, so they cannot use buildWorkspaceWhere. */
export const buildUserMemoryWhere = (
  db: LobeChatDatabase,
  userId: string,
  table: UserMemoryScopedTable,
): SQL => {
  const liveMemory = table.isDeleted
    ? notTrashed(table.isDeleted)
    : table.userMemoryId
      ? liveParentMemory(db, userId, table.userMemoryId)
      : table.userMemoryIds
        ? liveContextMemory(db, userId, table.userMemoryIds)
        : undefined;

  return and(eq(table.userId, userId), liveMemory) as SQL;
};
