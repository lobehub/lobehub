// @vitest-environment node
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { FileVisibilityRepository } from '../index';

/**
 * `vitest.config.server.mts` runs the suite with `isolate: false`, so by the time
 * this file runs the model modules can already be in the shared module cache and
 * a `vi.mock('../../../models/file')` silently keeps the real class. Drive the
 * real models against a fake connection instead: the lock contract is about the
 * statements the repository issues and their order, not about replacing the
 * models.
 */
const LOCK_SQL = 'pg_advisory_xact_lock';

const makeDb = (returning: unknown[][] = [[{ id: 'file-1' }], [{ id: 'doc-1' }]]) => {
  const queue = [...returning];
  const statements: { params: unknown[]; sql: string }[] = [];
  const setCalls: any[] = [];

  const execute = vi.fn(async (statement: any) => {
    statements.push(new PgDialect().sqlToQuery(statement));
  });

  const update = vi.fn(() => {
    const chain: any = {
      returning: async () => queue.shift() ?? [],
      set: (values: any) => {
        setCalls.push(values);
        return chain;
      },
      where: () => chain,
    };

    return chain;
  });

  const trx = { execute, update };
  const db = { transaction: vi.fn(async (callback: any) => callback(trx)) };

  return { db: db as any, execute, setCalls, statements, update };
};

describe('FileVisibilityRepository', () => {
  it('should take the per-file parse lock before it touches either aggregate', async () => {
    const { db, execute, setCalls, statements, update } = makeDb();

    await new FileVisibilityRepository(db, 'user-1', 'ws-1').setVisibility('file-1', 'public');

    expect(execute).toHaveBeenCalledTimes(1);
    expect(statements[0].sql).toContain(LOCK_SQL);
    // The key has to match `DocumentService.parseFile`, otherwise the two do not
    // exclude each other and the publish can still land mid-parse.
    expect(statements[0].params).toEqual(['parseFile:file-1']);

    // Lock first, then the two updates: a publish that starts mid-parse waits on
    // the lock the parse already holds instead of committing between the parse's
    // visibility read and its write.
    expect(execute.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
    expect(update).toHaveBeenCalledTimes(2);
    expect(setCalls).toEqual([
      expect.objectContaining({ visibility: 'public' }),
      { visibility: 'public' },
    ]);
  });

  it('should leave the documents alone when the file row did not change', async () => {
    // The visibility guard in `FileModel.setVisibility` matched nothing, so the
    // file is already in the requested state and there is nothing to mirror.
    const { db, setCalls, update } = makeDb([[]]);

    const updated = await new FileVisibilityRepository(db, 'user-1', 'ws-1').setVisibility(
      'file-1',
      'public',
    );

    expect(updated).toEqual([]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(setCalls).toHaveLength(1);
  });
});
