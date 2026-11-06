// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationsFolder = path.join(__dirname, '../migrations');

/**
 * The only migrations that may carry pg_search SQL. Deployments that do not run
 * pg_search (LobeHub Cloud uses Elasticsearch) skip exactly these two by their
 * identity and reject any other migration that reaches for the extension, so a
 * new BM25 index or `paradedb` call in a migration blocks those deployments.
 */
const PG_SEARCH_MIGRATIONS = new Set(['0090_enable_pg_search', '0093_add_bm25_indexes_with_icu']);

const PG_SEARCH_SQL = /\bpg_search\b|\bUSING\s+"?bm25"?\b|\bparadedb\.|@@@/i;

describe('migrations without pg_search', () => {
  it('keeps pg_search SQL out of every migration after the two that install it', () => {
    const offenders = readdirSync(migrationsFolder)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => file.replace(/\.sql$/, ''))
      .filter((tag) => !PG_SEARCH_MIGRATIONS.has(tag))
      .filter((tag) =>
        PG_SEARCH_SQL.test(readFileSync(path.join(migrationsFolder, `${tag}.sql`), 'utf8')),
      );

    expect(offenders).toEqual([]);
  });
});
