import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// @ts-ignore tsgo handle esm import cjs and compatibility issues
import {
  assertPgSearchReady,
  PgSearchNotReadyError,
} from '../../../../scripts/migrateServerDB/pgSearchGuard';

const migrationsFolder = join(__dirname, '../../migrations');

/**
 * Self-hosted deployments on plain PostgreSQL (Aiven, RDS, Neon without pg_search) select
 * `FTS_SEARCH_PROVIDER=pg_like` or `elasticsearch`, so the historical pg_search migrations must
 * skip themselves instead of aborting the upgrade. PGlite ships without pg_search, matching them.
 */
describe('pg_search migrations on a database without the extension', () => {
  const client = new PGlite({ extensions: { vector } });
  const db = drizzle({ client });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
    // Replaying every migration takes ~1s alone but can exceed the default timeout under a
    // fully parallel suite.
  }, 30_000);

  afterAll(async () => {
    await client.close();
  });

  it('applies every migration and skips BM25 setup', async () => {
    const applied = await db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`,
    );
    expect(applied.rows[0].count).toBe(readMigrationFiles({ migrationsFolder }).length);

    const extension = await db.execute(sql`SELECT 1 FROM pg_extension WHERE extname = 'pg_search'`);
    expect(extension.rows).toHaveLength(0);

    const bm25Indexes = await db.execute(
      sql`SELECT indexname FROM pg_indexes WHERE indexname LIKE '%_bm25_idx'`,
    );
    expect(bm25Indexes.rows).toHaveLength(0);
  });

  /** The migration entrypoints run this guard, so a skipped pg_search cannot reach the first search. */
  describe('startup guard', () => {
    const query = (text: string) => db.execute(sql.raw(text));

    it('stops a deployment that leaves the provider at the pg_search default', async () => {
      const error = await assertPgSearchReady(query, {}).catch((error_: unknown) => error_);

      expect(error).toBeInstanceOf(PgSearchNotReadyError);
      expect((error as Error).message).toContain('`pg_search` (the default)');
      expect((error as Error).message).toContain('FTS_SEARCH_PROVIDER=pg_like');
    });

    it('stops a deployment that selects pg_search explicitly', async () => {
      await expect(
        assertPgSearchReady(query, { FTS_SEARCH_PROVIDER: 'pg_search' }),
      ).rejects.toBeInstanceOf(PgSearchNotReadyError);
    });

    it.each(['pg_like', 'elasticsearch'])('lets %s start without pg_search', async (provider) => {
      await expect(
        assertPgSearchReady(query, { FTS_SEARCH_PROVIDER: provider }),
      ).resolves.toBeUndefined();
    });
  });
});
