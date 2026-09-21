import type { Client } from 'pg';

import { PG_SEARCH_BM25_INDEXES, type PgSearchInventory, readPgSearchInventory } from './inventory';

const EXPECTED_INDEXES_BY_NAME = new Map<string, { name: string; table: string }>(
  PG_SEARCH_BM25_INDEXES.map((index) => [index.name, index]),
);

export const assertOnlyLobeHubBm25Indexes = (inventory: PgSearchInventory) => {
  const unexpectedIndexes = inventory.bm25Indexes.filter(({ name, schema, table }) => {
    const expected = EXPECTED_INDEXES_BY_NAME.get(name);
    return !expected || schema !== 'public' || table !== expected.table;
  });

  if (unexpectedIndexes.length > 0) {
    throw new Error(
      `Refusing to remove unrecognized BM25 indexes: ${unexpectedIndexes
        .map(({ name, schema, table }) => `${schema}.${name} on ${table}`)
        .join(', ')}`,
    );
  }
};

export const assertElasticsearchCutover = (provider: string | undefined) => {
  if (provider !== 'elasticsearch') {
    throw new Error(
      'Set FTS_SEARCH_PROVIDER=elasticsearch and complete the search cutover before cleanup',
    );
  }
};

const recordIndexDrop = (index: string, status: 'started' | 'succeeded') => {
  console.log(JSON.stringify({ event: 'pg_search_index_drop', index, status }));
};

export const runPgSearchCleanup = async (client: Client) => {
  const before = await readPgSearchInventory(client);
  assertOnlyLobeHubBm25Indexes(before);

  await client.query(`SET lock_timeout = '2s'`);
  await client.query(`SET statement_timeout = '10min'`);

  for (const { name } of PG_SEARCH_BM25_INDEXES) {
    recordIndexDrop(name, 'started');
    await client.query(`DROP INDEX CONCURRENTLY IF EXISTS public."${name}"`);
    recordIndexDrop(name, 'succeeded');
  }

  const afterIndexes = await readPgSearchInventory(client);
  assertOnlyLobeHubBm25Indexes(afterIndexes);
  if (afterIndexes.bm25Indexes.length > 0) {
    throw new Error('BM25 indexes remain after cleanup');
  }

  await client.query('DROP EXTENSION IF EXISTS pg_search');

  const after = await readPgSearchInventory(client);
  if (after.extensionVersion || after.bm25Indexes.length > 0) {
    throw new Error('pg_search objects remain after cleanup');
  }

  return {
    after,
    before,
    removedIndexCount: before.bm25Indexes.length,
  };
};
