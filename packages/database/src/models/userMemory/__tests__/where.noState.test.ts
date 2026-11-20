import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { userMemories } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { buildUserMemoryWhere } from '../where';

const serverDB: LobeChatDatabase = await getTestDB();

const toSql = (table: Parameters<typeof buildUserMemoryWhere>[2]) =>
  new PgDialect().sqlToQuery(buildUserMemoryWhere(serverDB, 'user-1', table)).sql;

describe('buildUserMemoryWhere for a table without a state column', () => {
  it('falls back to the trash predicate instead of the visibility one', () => {
    // Some scoped tables are recycle-bin aware but carry no `state` column; the helper must not
    // emit a predicate for a column that does not exist.
    const tableWithoutState = {
      isDeleted: userMemories.isDeleted,
      userId: userMemories.userId,
    } as unknown as Parameters<typeof buildUserMemoryWhere>[2];

    const query = toSql(tableWithoutState);

    expect(query).toContain('"is_deleted" IS NOT TRUE');
    expect(query).not.toContain('"state"');
    expect(query).not.toContain('live_user_memories');
  });
});
