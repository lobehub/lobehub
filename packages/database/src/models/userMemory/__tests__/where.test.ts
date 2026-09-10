import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
} from '../../../schemas';
import { buildUserMemoryWhere } from '../where';

const serverDB = await getTestDB();
const toSql = (table: Parameters<typeof buildUserMemoryWhere>[2]) =>
  new PgDialect().sqlToQuery(buildUserMemoryWhere(serverDB, 'user-1', table)).sql;

describe('buildUserMemoryWhere', () => {
  it('filters the restorable base row directly', () => {
    expect(toSql(userMemories)).toContain('"user_memories"."is_deleted" IS NOT TRUE');
  });

  it.each([
    userMemoriesActivities,
    userMemoriesExperiences,
    userMemoriesIdentities,
    userMemoriesPreferences,
  ])('filters a singular child through its live base memory', (table) => {
    const query = toSql(table);

    expect(query).toContain(' in (select ');
    expect(query).toContain('"live_user_memories"."is_deleted" IS NOT TRUE');
    expect(query).toContain('"user_memory_id"');
  });

  it('keeps a context only when it is standalone or references a live base memory', () => {
    const query = toSql(userMemoriesContexts);

    expect(query).toContain('jsonb_array_length');
    expect(query).toContain('?| ARRAY');
    expect(query).toContain('"live_user_memories"."is_deleted" IS NOT TRUE');
  });
});
