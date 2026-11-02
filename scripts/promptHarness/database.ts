import { execFile, spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';

import { Client } from 'pg';

const execFileAsync = promisify(execFile);

const SAFE_IDENTIFIER = /^[a-z_][a-z\d_]*$/;

const assertIdentifier = (value: string): string => {
  if (!SAFE_IDENTIFIER.test(value)) throw new Error(`Unsafe PostgreSQL identifier: ${value}`);
  return value;
};

const runPsql = ({
  container,
  database,
  text,
  user,
}: {
  container: string;
  database: string;
  text: string;
  user: string;
}): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', database],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`psql failed (${code}): ${stderr}`));
    });
    child.stdin.end(text);
  });

export interface DatabaseConnectionParts {
  baseUrl: string;
  database: string;
  host: string;
  port: string;
  user: string;
}

export const parseDatabaseUrl = (databaseUrl: string): DatabaseConnectionParts => {
  const parsed = new URL(databaseUrl);
  const baseUrl = new URL(databaseUrl);
  baseUrl.pathname = '/';
  baseUrl.search = '';
  baseUrl.hash = '';
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL must include a database name.');
  return {
    baseUrl: baseUrl.toString(),
    database,
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username),
  };
};

export const buildDatabaseUrl = (parts: DatabaseConnectionParts, database: string): string => {
  const url = new URL(parts.baseUrl);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
};

export const cloneDatabase = async ({
  container,
  sourceDatabase,
  targetDatabase,
  user,
}: {
  container: string;
  sourceDatabase: string;
  targetDatabase: string;
  user: string;
}): Promise<void> => {
  assertIdentifier(sourceDatabase);
  assertIdentifier(targetDatabase);

  await execFileAsync('docker', [
    'exec',
    container,
    'createdb',
    '-U',
    user,
    '--maintenance-db=postgres',
    targetDatabase,
  ]);

  const dumpRestore = [
    'set -eo pipefail;',
    `pg_dump -U ${user} -d ${sourceDatabase} --format=custom`,
    '|',
    `pg_restore -U ${user} -d ${targetDatabase} --no-owner --no-privileges --clean --if-exists`,
  ].join(' ');

  await execFileAsync('docker', ['exec', container, 'bash', '-lc', dumpRestore], {
    maxBuffer: 16 * 1024 * 1024,
  });
};

export const seedDatabase = async ({
  container,
  database,
  fixturePath,
  user,
}: {
  container: string;
  database: string;
  fixturePath: string;
  user: string;
}): Promise<void> => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(fixturePath, 'utf8');
  await runPsql({ container, database, text: sql, user });
};

const decryptVault = (encrypted: string, secret: string): string => {
  const [ivHex, tagHex, payloadHex] = encrypted.split(':');
  if (!ivHex || !tagHex || !payloadHex) throw new Error('Invalid key vault ciphertext.');
  const key = Buffer.from(secret, 'base64');
  const decipher = createDecipheriv(`aes-${key.length * 8}-gcm`, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(payloadHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
};

const encryptVault = (plaintext: string, secret: string): string => {
  const key = Buffer.from(secret, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv(`aes-${key.length * 8}-gcm`, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
};

export const repointMockProvider = async ({
  databaseUrl,
  keyVaultsSecret,
  mockBaseUrl,
  providerId = 'openai',
  userId,
}: {
  databaseUrl: string;
  keyVaultsSecret: string;
  mockBaseUrl: string;
  providerId?: string;
  userId: string;
}): Promise<{ providerRowId: string; vaultKeys: string[] }> => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const { rows } = await client.query<{
      _id: string;
      key_vaults: string | null;
    }>(
      `SELECT _id, key_vaults
       FROM ai_providers
       WHERE id = $1 AND user_id = $2 AND workspace_id IS NULL`,
      [providerId, userId],
    );

    if (rows.length !== 1) {
      throw new Error(`Expected one personal ${providerId} provider row, found ${rows.length}.`);
    }
    if (!rows[0].key_vaults) throw new Error('Provider row has no encrypted credentials.');

    const vaults = JSON.parse(decryptVault(rows[0].key_vaults, keyVaultsSecret)) as Record<
      string,
      unknown
    >;
    vaults.apiKey = 'prompt-harness-not-a-secret';
    vaults.baseURL = mockBaseUrl;
    const encrypted = encryptVault(JSON.stringify(vaults), keyVaultsSecret);

    await client.query(
      `UPDATE ai_providers
       SET key_vaults = $1, updated_at = now()
       WHERE _id = $2`,
      [encrypted, rows[0]._id],
    );

    return {
      providerRowId: rows[0]._id,
      vaultKeys: Object.keys(vaults).sort(),
    };
  } finally {
    await client.end();
  }
};

export const dropDatabase = async ({
  container,
  database,
  user,
}: {
  container: string;
  database: string;
  user: string;
}): Promise<void> => {
  assertIdentifier(database);
  await runPsql({
    container,
    database: 'postgres',
    text: [
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid();`,
      `DROP DATABASE IF EXISTS "${database}";`,
    ].join('\n'),
    user,
  });
};

export const fixturePath = (repoRoot: string): string =>
  path.join(repoRoot, 'scripts/promptHarness/fixtures/seed.sql');
