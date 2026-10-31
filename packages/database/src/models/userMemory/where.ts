import { and, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';

import { userMemories } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { visibleMemoryState } from '../../utils/memoryVisibility';
import { notTrashed } from '../../utils/softDelete';

const liveUserMemories = alias(userMemories, 'live_user_memories');

interface UserMemoryScopedTable {
  isDeleted?: AnyPgColumn;
  state?: AnyPgColumn;
  userId: AnyPgColumn;
  userMemoryId?: AnyPgColumn;
  userMemoryIds?: AnyPgColumn;
}

const liveMemoryIds = (db: LobeChatDatabase, userId: string) =>
  db
    .select({ id: liveUserMemories.id })
    .from(liveUserMemories)
    .where(
      and(
        eq(liveUserMemories.userId, userId),
        notTrashed(liveUserMemories.isDeleted),
        visibleMemoryState(liveUserMemories.state),
      ),
    );

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
  let liveMemory: SQL | undefined;
  if (table.isDeleted)
    liveMemory = table.state
      ? (and(notTrashed(table.isDeleted), visibleMemoryState(table.state)) as SQL)
      : notTrashed(table.isDeleted);
  else if (table.userMemoryId && table.userMemoryIds) {
    // Contexts carry both while rows move from the legacy id list to a single parent: a row with
    // a parent is judged by it, a row without one still by its legacy list.
    liveMemory = or(
      and(
        sql`${table.userMemoryId} IS NOT NULL`,
        inArray(table.userMemoryId, liveMemoryIds(db, userId)),
      ),
      and(isNull(table.userMemoryId), liveContextMemory(db, userId, table.userMemoryIds)),
    ) as SQL;
  } else if (table.userMemoryId) liveMemory = liveParentMemory(db, userId, table.userMemoryId);
  else if (table.userMemoryIds) liveMemory = liveContextMemory(db, userId, table.userMemoryIds);

  return and(eq(table.userId, userId), liveMemory) as SQL;
};
