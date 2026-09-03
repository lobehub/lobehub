import type { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PgSearchInventory } from './inventory';
import { PG_SEARCH_BM25_INDEXES } from './inventory';
import {
  assertElasticsearchCutover,
  assertOnlyLobeHubBm25Indexes,
  runPgSearchCleanup,
} from './operations';

const readPgSearchInventory = vi.hoisted(() => vi.fn());

vi.mock('./inventory', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readPgSearchInventory,
}));

const createInventory = ({
  extensionVersion = '0.15.26',
  indexes = true,
}: {
  extensionVersion?: null | string;
  indexes?: boolean;
} = {}): PgSearchInventory => ({
  bm25Indexes: indexes
    ? PG_SEARCH_BM25_INDEXES.map(({ name, table }) => ({
        name,
        schema: 'public',
        table,
        valid: true,
      }))
    : [],
  extensionVersion,
});

const createClient = () =>
  ({ query: vi.fn().mockResolvedValue({ rows: [] }) }) as unknown as Client;

beforeEach(() => {
  readPgSearchInventory.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pg_search cleanup operations', () => {
  it('requires Elasticsearch to serve search before cleanup', () => {
    expect(() => assertElasticsearchCutover('pg_search')).toThrow(
      'Set FTS_SEARCH_PROVIDER=elasticsearch',
    );
    expect(() => assertElasticsearchCutover(undefined)).toThrow(
      'Set FTS_SEARCH_PROVIDER=elasticsearch',
    );
    expect(() => assertElasticsearchCutover('elasticsearch')).not.toThrow();
  });

  it('rejects BM25 indexes not managed by LobeHub', () => {
    const inventory = createInventory();
    inventory.bm25Indexes.push({
      name: 'custom_bm25_idx',
      schema: 'public',
      table: 'custom_documents',
      valid: true,
    });

    expect(() => assertOnlyLobeHubBm25Indexes(inventory)).toThrow(
      'Refusing to remove unrecognized BM25 indexes',
    );
  });

  it('drops known indexes concurrently before removing the extension', async () => {
    const client = createClient();
    readPgSearchInventory
      .mockResolvedValueOnce(createInventory())
      .mockResolvedValueOnce(createInventory({ indexes: false }))
      .mockResolvedValueOnce(createInventory({ extensionVersion: null, indexes: false }));

    const result = await runPgSearchCleanup(client);
    const queries = vi.mocked(client.query).mock.calls.map(([sql]) => String(sql));
    const indexDrops = queries.filter((sql) => sql.startsWith('DROP INDEX CONCURRENTLY'));
    const extensionDropIndex = queries.indexOf('DROP EXTENSION IF EXISTS pg_search');

    expect(indexDrops).toHaveLength(PG_SEARCH_BM25_INDEXES.length);
    expect(extensionDropIndex).toBeGreaterThan(queries.lastIndexOf(indexDrops.at(-1)!));
    expect(queries.some((sql) => sql.includes('CASCADE'))).toBe(false);
    expect(result.removedIndexCount).toBe(PG_SEARCH_BM25_INDEXES.length);
  });

  it('does not mutate when the initial inventory contains an unknown index', async () => {
    const client = createClient();
    const inventory = createInventory();
    inventory.bm25Indexes.push({
      name: 'custom_bm25_idx',
      schema: 'custom',
      table: 'documents',
      valid: true,
    });
    readPgSearchInventory.mockResolvedValueOnce(inventory);

    await expect(runPgSearchCleanup(client)).rejects.toThrow(
      'Refusing to remove unrecognized BM25 indexes',
    );
    expect(client.query).not.toHaveBeenCalled();
  });

  it('is safe to rerun after cleanup has completed', async () => {
    const client = createClient();
    const emptyInventory = createInventory({ extensionVersion: null, indexes: false });
    readPgSearchInventory.mockResolvedValue(emptyInventory);

    const result = await runPgSearchCleanup(client);

    expect(result.removedIndexCount).toBe(0);
  });
});
