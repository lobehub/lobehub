import pg from 'pg';

import { readPgSearchInventory } from './inventory';
import { assertElasticsearchCutover, runPgSearchCleanup } from './operations';
import { parsePgSearchCleanupOptions } from './options';

const { Client } = pg;

const run = async () => {
  const options = parsePgSearchCleanupOptions(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  if (options.mode === 'apply') assertElasticsearchCutover(process.env.FTS_SEARCH_PROVIDER);

  const client = new Client({
    application_name: 'lobehub-pg-search-cleanup',
    connectionString: databaseUrl,
    connectionTimeoutMillis: 8000,
    statement_timeout: 600_000,
  });
  await client.connect();

  try {
    if (options.mode === 'status') {
      console.log(JSON.stringify(await readPgSearchInventory(client), null, 2));
      return;
    }

    console.log(JSON.stringify(await runPgSearchCleanup(client), null, 2));
  } finally {
    await client.end();
  }
};

void run().catch((error) => {
  console.error('pg_search cleanup failed:', error);
  process.exitCode = 1;
});
