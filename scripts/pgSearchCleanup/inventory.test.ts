import type { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { readPgSearchInventory } from './inventory';

describe('readPgSearchInventory', () => {
  it('returns only the extension version and BM25 index identity', async () => {
    const query = vi.fn().mockImplementation(async (sql: string) =>
      sql.includes('FROM pg_extension')
        ? { rows: [{ extversion: '0.15.26' }] }
        : {
            rows: [
              {
                index_name: 'messages_bm25_idx',
                is_valid: true,
                schema_name: 'public',
                table_name: 'messages',
              },
            ],
          },
    );
    const client = { query } as unknown as Client;

    await expect(readPgSearchInventory(client)).resolves.toEqual({
      bm25Indexes: [
        {
          name: 'messages_bm25_idx',
          schema: 'public',
          table: 'messages',
          valid: true,
        },
      ],
      extensionVersion: '0.15.26',
    });
  });
});
