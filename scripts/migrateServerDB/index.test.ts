import { DrizzleQueryError } from 'drizzle-orm/errors';
import { beforeAll, describe, expect, it, vi } from 'vitest';

let isMissingMigrationTableError: (error: unknown) => boolean;

beforeAll(async () => {
  // Importing index.ts bootstraps the CLI. Keep this test explicitly offline.
  vi.stubEnv('DATABASE_URL', '');
  ({ isMissingMigrationTableError } = await import('./index'));
});

describe('isMissingMigrationTableError', () => {
  it('recognizes a PostgreSQL 42P01 wrapped by DrizzleQueryError', () => {
    const cause = Object.assign(
      new Error('relation "drizzle.__drizzle_migrations" does not exist'),
      { code: '42P01' },
    );
    const wrapped = new DrizzleQueryError('select * from drizzle.__drizzle_migrations', [], cause);

    expect(isMissingMigrationTableError(wrapped)).toBe(true);
  });

  it('walks only a bounded cause chain and rejects unrelated missing relations', () => {
    const unrelated = Object.assign(new Error('relation "users" does not exist'), {
      code: '42P01',
    });
    const wrapped = new DrizzleQueryError('select * from users', [], unrelated);
    expect(isMissingMigrationTableError(wrapped)).toBe(false);

    const missingTable = Object.assign(
      new Error('relation "drizzle.__drizzle_migrations" does not exist'),
      { code: '42P01' },
    );
    let deep: unknown = missingTable;
    for (let index = 0; index < 6; index += 1) deep = { cause: deep };
    expect(isMissingMigrationTableError(deep)).toBe(false);
  });

  it('recognizes a missing drizzle schema as an empty migration metadata store', () => {
    const cause = Object.assign(new Error('schema "drizzle" does not exist'), { code: '3F000' });

    expect(isMissingMigrationTableError(new DrizzleQueryError('select 1', [], cause))).toBe(true);
  });
});
