import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle as nodeDrizzle } from 'drizzle-orm/node-postgres';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { drizzle as pgliteDrizzle } from 'drizzle-orm/pglite';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  getUniqueViolation,
  isUniqueViolation,
  PG_UNIQUE_VIOLATION,
  uniqueViolationConstraint,
} from './uniqueViolation';

const probe = pgTable('unique_violation_probe', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
});

const CREATE_PROBE =
  'CREATE TEMP TABLE unique_violation_probe (id integer CONSTRAINT unique_violation_probe_pkey PRIMARY KEY, name text NOT NULL)';

const catchError = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the statement to fail');
};

interface DriverHarness {
  db: ReturnType<typeof pgliteDrizzle> | ReturnType<typeof nodeDrizzle>;
  /** Runs SQL straight on the driver, so its error is not wrapped. */
  raw: (statement: string) => Promise<unknown>;
}

/**
 * Both drivers raise their own error (`code` on the error itself); drizzle
 * wraps it in a `DrizzleQueryError` whose `cause` is that driver error.
 */
const describeDriver = (
  name: string,
  setup: () => Promise<DriverHarness & { close: () => Promise<void> }>,
  skip = false,
) =>
  describe.skipIf(skip)(`${name} errors`, () => {
    let harness: DriverHarness & { close: () => Promise<void> };

    // PGlite boots a whole Postgres in WASM; give it room on a loaded host.
    beforeAll(async () => {
      harness = await setup();
      await harness.raw(CREATE_PROBE);
      await harness.raw("INSERT INTO unique_violation_probe VALUES (1, 'first')");
    }, 60_000);

    afterAll(async () => {
      await harness?.close();
    });

    it('reads a unique violation raised by the driver itself', async () => {
      const error = await catchError(() =>
        harness.raw("INSERT INTO unique_violation_probe VALUES (1, 'again')"),
      );

      expect((error as { code?: string }).code).toBe(PG_UNIQUE_VIOLATION);
      expect(isUniqueViolation(error)).toBe(true);
      expect(uniqueViolationConstraint(error)).toBe('unique_violation_probe_pkey');
      expect(getUniqueViolation(error)?.detail).toBe('Key (id)=(1) already exists.');
    });

    it('reads a unique violation wrapped by drizzle', async () => {
      const error = await catchError(() =>
        harness.db.insert(probe).values({ id: 1, name: 'again' }),
      );

      // The wrapper carries no code; the driver error sits on `cause`.
      expect((error as { code?: string }).code).toBeUndefined();
      expect((error as { cause?: { code?: string } }).cause?.code).toBe(PG_UNIQUE_VIOLATION);
      expect(isUniqueViolation(error)).toBe(true);
      expect(uniqueViolationConstraint(error)).toBe('unique_violation_probe_pkey');
      expect(getUniqueViolation(error)?.detail).toBe('Key (id)=(1) already exists.');
    });

    it('rejects other constraint violations at either level', async () => {
      const raw = await catchError(() =>
        harness.raw('INSERT INTO unique_violation_probe VALUES (2, NULL)'),
      );
      const wrapped = await catchError(() =>
        harness.db.execute(sql`INSERT INTO unique_violation_probe VALUES (3, NULL)`),
      );

      for (const error of [raw, wrapped]) {
        expect(isUniqueViolation(error)).toBe(false);
        expect(uniqueViolationConstraint(error)).toBeUndefined();
      }
    });
  });

describeDriver('PGlite', async () => {
  const client = new PGlite();
  return {
    close: () => client.close(),
    db: pgliteDrizzle({ client }),
    raw: (statement) => client.query(statement),
  };
});

describeDriver(
  'node-postgres',
  async () => {
    // A single client (not a pool) so the temp table stays on one session.
    const client = new Client({ connectionString: process.env.DATABASE_TEST_URL });
    await client.connect();
    return {
      close: () => client.end(),
      db: nodeDrizzle({ client }),
      raw: (statement) => client.query(statement),
    };
  },
  !process.env.DATABASE_TEST_URL,
);

describe('non-error values', () => {
  it('treats anything without a unique-violation code as no violation', () => {
    for (const value of [null, undefined, 'duplicate key value', 23_505, {}, { cause: null }]) {
      expect(isUniqueViolation(value)).toBe(false);
    }
    expect(isUniqueViolation({ cause: 'duplicate key value' })).toBe(false);
  });

  it('reports an empty constraint name when the driver omits it', () => {
    expect(uniqueViolationConstraint({ code: PG_UNIQUE_VIOLATION })).toBe('');
    expect(uniqueViolationConstraint({ cause: { code: PG_UNIQUE_VIOLATION } })).toBe('');
  });
});
