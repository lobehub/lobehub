// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { LobeChatDatabase } from '../../type';
import { DrizzleMigrationModel } from '../drizzleMigration';

const serverDB: LobeChatDatabase = await getTestDB();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DrizzleMigrationModel coverage', () => {
  it('counts 0 tables when the driver parses COUNT(*) as the number 0', async () => {
    // node-postgres returns int8 as a string, but a driver that parses it to a number
    // returns 0 for an empty public schema (e.g. before the first migration).
    vi.spyOn(serverDB, 'execute').mockResolvedValueOnce({
      rows: [{ table_count: 0 }],
    } as unknown as Awaited<ReturnType<LobeChatDatabase['execute']>>);

    await expect(new DrizzleMigrationModel(serverDB).getTableCounts()).resolves.toBe(0);
  });
});
