// @vitest-environment node
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { lockFileForWrite } from '../fileWriteLock';

const makeDb = () => {
  const statements: { params: unknown[]; sql: string }[] = [];

  const execute = vi.fn(async (statement: any) => {
    statements.push(new PgDialect().sqlToQuery(statement));
  });

  return { db: { execute } as any, statements };
};

describe('lockFileForWrite', () => {
  it('should take the shared per-file advisory lock with the cross-version key', async () => {
    const { db, statements } = makeDb();

    await lockFileForWrite(db, 'file-1');

    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toContain('pg_advisory_xact_lock');
    // Every path that writes a file and its parsed documents has to take this
    // exact key; a different one leaves the paths free to interleave.
    expect(statements[0].params).toEqual(['parseFile:file-1']);
  });
});
