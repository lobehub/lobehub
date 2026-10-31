import { spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { Client } from 'pg';

import { upgradeLobeBenchDatabase } from './plan';

// Deliberately no dotenv import and no DATABASE_URL fallback. This maintenance
// tool is never called by startup/deployment; the operator names the target.
const { values } = parseArgs({
  options: {
    'apply': { default: false, type: 'boolean' },
    'backup': { type: 'string' },
    'database': { type: 'string' },
    'url-env': { type: 'string' },
  },
});

const envName = values['url-env'];
if (!envName || !process.env[envName] || !values.database) {
  throw new Error('Pass --url-env NAME and --database NAME; defaults are intentionally disabled.');
}
const connectionString = process.env[envName]!;
const target = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
  throw new Error('This unpublished-branch repair supports local databases only.');
}
if (decodeURIComponent(target.pathname.slice(1)) !== values.database) {
  throw new Error('The explicit database name does not match the selected connection.');
}
if (values.apply) {
  if (!values.backup || (await stat(values.backup)).size === 0) {
    throw new Error('Apply requires --backup pointing at a nonempty, tested pg_dump archive.');
  }
  const inspect = spawnSync('pg_restore', ['--list', values.backup], { stdio: 'ignore' });
  if (inspect.status !== 0) throw new Error('Backup is not a readable pg_dump archive.');
}

const client = new Client({ connectionString });
try {
  await client.connect();
  const result = await upgradeLobeBenchDatabase(client, {
    apply: values.apply,
    migrationsFolder: path.resolve(import.meta.dirname, '../../packages/database/migrations'),
  });
  console.log(JSON.stringify({ database: values.database, ...result }));
} finally {
  await client.end();
}
