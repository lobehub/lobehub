/**
 * Check whether `db:migrate`, `build`, and `start` touch user data.
 *
 * Usage:
 *   tsx scripts/checkDbPersistence/index.ts snapshot
 *   tsx scripts/checkDbPersistence/index.ts run [--with-build] [--with-start]
 *
 * `run` captures a baseline, executes each pipeline step, and compares snapshots.
 * Snapshots are also written to `.cache/db-persistence/latest.json`.
 */
import { execSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

const CACHE_DIR = join(process.cwd(), '.cache/db-persistence');
const SNAPSHOT_FILE = join(CACHE_DIR, 'latest.json');
const POSTGRES_DATA_DIR = join(
  process.env.PANACHAT_DEV_DATA_DIR ?? join(homedir(), '.local/share/panachat-data-dev'),
  'postgres',
);

type UserRow = {
  createdAt: string;
  email: string | null;
  id: string;
};

export type DbSnapshot = {
  capturedAt: string;
  database: {
    database: string;
    driver: string | null;
    host: string;
    port: string;
    urlFingerprint: string;
  };
  docker: {
    postgresContainer: string | null;
    postgresDataDirBytes: number | null;
    postgresDataDirExists: boolean;
  };
  migrations: {
    applied: number;
    latestHash: string | null;
  };
  users: {
    count: number;
    fingerprint: string;
    rows: UserRow[];
  };
};

const loadEnv = () => {
  const env = process.env.NODE_ENV || 'development';
  dotenvExpand.expand(dotenv.config());
  dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}` }));
  dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}.local` }));
};

const maskDatabaseUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    const user = parsed.username ? `${parsed.username}@` : '';
    return `${parsed.protocol}//${user}${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
  } catch {
    return '(invalid DATABASE_URL)';
  }
};

const fingerprintUrl = (url: string) => createHash('sha256').update(url).digest('hex').slice(0, 16);

const fingerprintUsers = (rows: UserRow[]) =>
  createHash('sha256')
    .update(
      rows
        .map((row) => `${row.id}|${row.email ?? ''}|${row.createdAt}`)
        .sort()
        .join('\n'),
    )
    .digest('hex')
    .slice(0, 16);

const readPostgresDataDirBytes = () => {
  if (!existsSync(POSTGRES_DATA_DIR)) return null;

  const walk = (dir: string): number => {
    let total = 0;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) total += walk(fullPath);
        else total += statSync(fullPath).size;
      }
    } catch {
      return total;
    }
    return total;
  };

  return walk(POSTGRES_DATA_DIR);
};

const dockerPostgresStatus = () => {
  const result = spawnSync('docker', ['inspect', '-f', '{{.State.Status}}', 'lobe-postgres'], {
    encoding: 'utf8',
  });

  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
};

export const captureSnapshot = async (): Promise<DbSnapshot> => {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Load .env before running this check.');
  }

  const parsed = new URL(databaseUrl);

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    const usersResult = await client.query<{
      created_at: Date;
      email: string | null;
      id: string;
    }>(
      `SELECT id, email, created_at
       FROM users
       ORDER BY created_at ASC`,
    );

    const migrationResult = await client.query<{ created_at: string; hash: string }>(
      `SELECT hash, created_at
       FROM drizzle.__drizzle_migrations
       ORDER BY created_at DESC
       LIMIT 1`,
    );

    const migrationCount = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM drizzle.__drizzle_migrations`,
    );

    const rows: UserRow[] = usersResult.rows.map((row) => ({
      createdAt: row.created_at.toISOString(),
      email: row.email,
      id: row.id,
    }));

    return {
      capturedAt: new Date().toISOString(),
      database: {
        database: parsed.pathname.replace(/^\//, '') || '(default)',
        driver: process.env.DATABASE_DRIVER ?? null,
        host: parsed.hostname,
        port: parsed.port || '5432',
        urlFingerprint: fingerprintUrl(databaseUrl),
      },
      docker: {
        postgresContainer: dockerPostgresStatus(),
        postgresDataDirBytes: readPostgresDataDirBytes(),
        postgresDataDirExists: existsSync(POSTGRES_DATA_DIR),
      },
      migrations: {
        applied: Number(migrationCount.rows[0]?.count ?? 0),
        latestHash: migrationResult.rows[0]?.hash ?? null,
      },
      users: {
        count: rows.length,
        fingerprint: fingerprintUsers(rows),
        rows,
      },
    };
  } finally {
    await client.end();
  }
};

const writeSnapshot = (snapshot: DbSnapshot) => {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
};

const printSnapshot = (label: string, snapshot: DbSnapshot) => {
  console.log(`\n=== ${label} ===`);
  console.log(`time:        ${snapshot.capturedAt}`);
  console.log(
    `database:    ${snapshot.database.host}:${snapshot.database.port}/${snapshot.database.database} (driver=${snapshot.database.driver ?? 'default'}, fp=${snapshot.database.urlFingerprint})`,
  );
  console.log(
    `docker:      container=${snapshot.docker.postgresContainer ?? 'n/a'}, dataDir=${snapshot.docker.postgresDataDirExists ? `${snapshot.docker.postgresDataDirBytes ?? 0} bytes` : 'missing'}`,
  );
  console.log(
    `migrations:  ${snapshot.migrations.applied} applied (latest=${snapshot.migrations.latestHash ?? 'none'})`,
  );
  console.log(`users:       ${snapshot.users.count} (fingerprint=${snapshot.users.fingerprint})`);

  if (snapshot.users.rows.length > 0) {
    for (const row of snapshot.users.rows) {
      console.log(`  - ${row.email ?? '(no email)'} [${row.id}] created ${row.createdAt}`);
    }
  }
};

type Diff = {
  field: string;
  after: string;
  before: string;
};

export const diffSnapshots = (before: DbSnapshot, after: DbSnapshot): Diff[] => {
  const diffs: Diff[] = [];

  const compare = (field: string, left: string | number | null, right: string | number | null) => {
    if (left !== right) diffs.push({ after: String(right), before: String(left), field });
  };

  compare('database.urlFingerprint', before.database.urlFingerprint, after.database.urlFingerprint);
  compare('database.host', before.database.host, after.database.host);
  compare('database.database', before.database.database, after.database.database);
  compare('users.count', before.users.count, after.users.count);
  compare('users.fingerprint', before.users.fingerprint, after.users.fingerprint);
  compare('migrations.applied', before.migrations.applied, after.migrations.applied);
  compare(
    'docker.postgresDataDirBytes',
    before.docker.postgresDataDirBytes,
    after.docker.postgresDataDirBytes,
  );

  return diffs;
};

const runCommand = (label: string, command: string) => {
  console.log(`\n→ Running: ${command}`);
  const started = Date.now();
  execSync(command, { cwd: process.cwd(), stdio: 'inherit' });
  console.log(`✓ ${label} finished in ${Date.now() - started}ms`);
};

const probeStart = async () => {
  const port = process.env.PORT || '3210';
  const { spawn } = await import('node:child_process');

  const child = spawn('pnpm', ['start'], {
    cwd: process.cwd(),
    detached: true,
    env: process.env,
    stdio: 'ignore',
  });

  child.unref();

  await new Promise((resolve) => {
    setTimeout(resolve, 8000);
  });

  spawnSync('bash', ['-lc', `lsof -ti:${port} | xargs -r kill`], {
    cwd: process.cwd(),
    stdio: 'ignore',
  });
};

const diagnoseLoss = (before: DbSnapshot, after: DbSnapshot, step: string) => {
  console.error(`\n❌ User data changed after: ${step}`);

  if (before.database.urlFingerprint !== after.database.urlFingerprint) {
    console.error(
      '   Likely cause: DATABASE_URL changed between steps (different host/db or credentials).',
    );
    console.error(`   before: ${maskDatabaseUrl(process.env.DATABASE_URL ?? '')}`);
  }

  if (
    before.docker.postgresDataDirBytes &&
    after.docker.postgresDataDirBytes &&
    after.docker.postgresDataDirBytes < before.docker.postgresDataDirBytes * 0.5
  ) {
    console.error(
      '   Likely cause: Postgres data directory shrank — docker volume reset or `dev:docker:reset`.',
    );
  }

  if (
    after.users.count === 0 &&
    before.users.count > 0 &&
    before.migrations.applied === after.migrations.applied
  ) {
    console.error(
      '   Likely cause: app/migrate now points at a different empty database, not migration deleting rows.',
    );
  }

  if (after.migrations.applied < before.migrations.applied) {
    console.error('   Likely cause: migration journal was reset on a fresh database volume.');
  }
};

const assertUsersPreserved = async (label: string, baseline: DbSnapshot) => {
  const current = await captureSnapshot();
  printSnapshot(label, current);
  writeSnapshot(current);

  const diffs = diffSnapshots(baseline, current);
  const userLoss =
    current.users.count < baseline.users.count ||
    (baseline.users.count > 0 && current.users.fingerprint !== baseline.users.fingerprint);

  if (userLoss) {
    diagnoseLoss(baseline, current, label);
    process.exit(1);
  }

  const nonUserDiffs = diffs.filter(
    (diff) => !diff.field.startsWith('migrations.') && diff.field !== 'docker.postgresDataDirBytes',
  );

  if (nonUserDiffs.length > 0) {
    console.warn(`\n⚠️ Non-user changes detected after ${label}:`);
    for (const diff of nonUserDiffs)
      console.warn(`   ${diff.field}: ${diff.before} → ${diff.after}`);
  } else {
    console.log(`\n✅ Users preserved after ${label}`);
  }

  return current;
};

const runScenario = async (options: { withBuild: boolean; withStart: boolean }) => {
  loadEnv();

  console.log('DB persistence check — migrate / build / start should not delete users.');
  console.log(`DATABASE_URL target: ${maskDatabaseUrl(process.env.DATABASE_URL ?? '')}`);

  const baseline = await captureSnapshot();
  printSnapshot('baseline', baseline);
  writeSnapshot(baseline);

  if (baseline.users.count === 0) {
    console.warn(
      '\n⚠️ Baseline has 0 users. Create/sign up a test user first, then re-run to detect loss.',
    );
  }

  runCommand('db:migrate', 'pnpm db:migrate');
  let current = await assertUsersPreserved('after db:migrate', baseline);

  if (options.withBuild) {
    runCommand('build', 'pnpm build');
    current = await assertUsersPreserved('after build', baseline);
  }

  if (options.withStart) {
    console.log('\n→ Running: pnpm start (8s probe, then kill)');
    await probeStart();
    current = await assertUsersPreserved('after start probe', baseline);
  }

  console.log('\n✅ Scenario complete — no user data loss detected.');
  console.log(`Snapshot saved to ${SNAPSHOT_FILE}`);
  console.log(`Final users: ${current.users.count}`);
};

const main = async () => {
  const command = process.argv[2] ?? 'run';
  const withBuild = process.argv.includes('--with-build');
  const withStart = process.argv.includes('--with-start');

  loadEnv();

  if (command === 'snapshot') {
    const snapshot = await captureSnapshot();
    printSnapshot('snapshot', snapshot);
    writeSnapshot(snapshot);
    console.log(`\nSaved: ${SNAPSHOT_FILE}`);
    return;
  }

  if (command === 'run') {
    await runScenario({ withBuild, withStart });
    return;
  }

  console.error('Usage:');
  console.error('  tsx scripts/checkDbPersistence/index.ts snapshot');
  console.error('  tsx scripts/checkDbPersistence/index.ts run [--with-build] [--with-start]');
  process.exit(1);
};

const isMain = process.argv[1]?.endsWith('checkDbPersistence/index.ts');

if (isMain) {
  main().catch((error) => {
    console.error('❌ DB persistence check failed:', error);
    process.exit(1);
  });
}
