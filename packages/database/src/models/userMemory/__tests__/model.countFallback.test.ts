// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { LayersEnum } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { drizzle as proxyDrizzle } from 'drizzle-orm/pg-proxy';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import * as schema from '../../../schemas';
import { users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { UserMemoryIdentityModel } from '../identity';
import { UserMemoryModel } from '../model';

const userId = 'memory-count-fallback-test-user';

const serverDB: LobeChatDatabase = await getTestDB();
const client = (serverDB as unknown as { $client: PGlite | Pool }).$client;

/** Runs a statement on the real test client: PGlite (client-db suite) or node-postgres. */
const runOnTestDB = async (text: string, values: unknown[], arrayMode: boolean) => {
  if (client instanceof PGlite) {
    return client.query(text, values, { rowMode: arrayMode ? 'array' : 'object' });
  }

  return client.query({ rowMode: arrayMode ? 'array' : undefined, text, values });
};

/**
 * Forwards every statement to the real test database, but answers `SELECT COUNT(...)` with no rows,
 * so the `totalResult[0]?.count ?? 0` fallbacks see an aggregate that produced nothing.
 */
const countlessDB = proxyDrizzle(
  async (text, params, method) => {
    if (/^select count\(/i.test(text.trim())) return { rows: [] };

    const result = await runOnTestDB(text, params, method === 'all');

    return { rows: result.rows };
  },
  { schema },
) as unknown as LobeChatDatabase;

beforeAll(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });

  const seed = new UserMemoryModel(serverDB, userId);
  await seed.createContextMemory({ context: {}, memoryLayer: LayersEnum.Context } as any);
  await seed.createActivityMemory({
    activity: { status: 'completed' },
    memoryLayer: LayersEnum.Activity,
  } as any);
  await seed.createExperienceMemory({
    experience: {},
    memoryLayer: LayersEnum.Experience,
  } as any);
  await seed.createPreferenceMemory({
    memoryLayer: LayersEnum.Preference,
    preference: {},
  } as any);
  await seed.addIdentityEntry({ identity: { relationship: 'self', type: 'personal' } } as any);
});

// Memory rows cascade from the user row.
afterAll(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('userMemory paginated queries - aggregate with no rows', () => {
  it.each([
    LayersEnum.Context,
    LayersEnum.Activity,
    LayersEnum.Experience,
    LayersEnum.Identity,
    LayersEnum.Preference,
  ])('queryMemories(%s) still returns rows and reports total 0', async (layer) => {
    const result = await new UserMemoryModel(countlessDB, userId).queryMemories({ layer });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ layer });
    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 0 });
  });

  it('identity queryList() still returns rows and reports total 0', async () => {
    const result = await new UserMemoryIdentityModel(countlessDB, userId).queryList();

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ relationship: 'self', type: 'personal' });
    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 0 });
  });
});
