#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const envFile = path.join(root, '.env');
const nextPort = Number(process.env.HEYANG_PREFLIGHT_NEXT_PORT || 3010);
const vitePort = Number(process.env.HEYANG_PREFLIGHT_VITE_PORT || 9876);

const checks = [];

const ok = (name, detail = '') => checks.push({ name, ok: true, detail });
const fail = (name, detail, fix) => checks.push({ name, ok: false, detail, fix });

const run = (command, args, options = {}) => {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    }).trim();
  } catch (error) {
    const stderr = error.stderr?.toString?.().trim();
    const stdout = error.stdout?.toString?.().trim();
    const message = stderr || stdout || error.message;
    const wrapped = new Error(message);
    wrapped.cause = error;
    throw wrapped;
  }
};

const readEnvValue = (key) => {
  if (!fs.existsSync(envFile)) return undefined;
  const line = fs
    .readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((item) => item.trim().startsWith(`${key}=`));
  if (!line) return undefined;
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
};

const databaseUrl = readEnvValue('DATABASE_URL');
let dbUser = process.env.HEYANG_DB_USER || 'postgres';
let dbName = process.env.HEYANG_DB_NAME || 'lobechat';

if (databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    dbUser = decodeURIComponent(url.username || dbUser);
    dbName = decodeURIComponent(url.pathname.replace(/^\//, '') || dbName);
  } catch {
    // Keep the safe local defaults.
  }
}

const testPort = (port) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(1500, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });

const dockerPs = () =>
  run('docker', ['ps', '--format', '{{.Names}}|{{.Image}}|{{.Status}}']);

const findContainer = (predicate) => {
  const lines = dockerPs()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, image, status] = line.split('|');
      return { image, name, status };
    });
  return lines.find(predicate);
};

const postgresRepair = [
  'docker rm -f lobe-postgres',
  'docker run -d --name lobe-postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=lobechat -e POSTGRES_HOST_AUTH_METHOD=trust -p 5432:5432 -v lobe-postgres-data:/var/lib/postgresql/data paradedb/paradedb:latest-pg17 -c shared_preload_libraries=pg_search',
  'npm.cmd run db:migrate',
].join('\n');

async function main() {
  try {
    const pg = findContainer((item) => item.name === 'lobe-postgres');
    if (!pg) {
      fail('Postgres container', 'lobe-postgres is not running.', postgresRepair);
    } else if (!pg.image.includes('paradedb')) {
      fail(
        'Postgres image',
        `lobe-postgres is running image ${pg.image}, expected paradedb/paradedb:latest-pg17.`,
        postgresRepair,
      );
    } else {
      ok('Postgres container', `${pg.name} (${pg.image})`);
    }
  } catch (error) {
    fail('Docker', `Cannot list containers: ${error.message}`, 'Start Docker Desktop, then rerun pnpm heyang:preflight.');
  }

  const pgAvailable = checks.find((item) => item.name === 'Postgres container')?.ok;

  if (pgAvailable) {
    try {
      run('docker', ['exec', 'lobe-postgres', 'pg_isready', '-U', dbUser, '-d', dbName]);
      ok('Postgres readiness', `pg_isready passed for database ${dbName}.`);
    } catch (error) {
      fail('Postgres readiness', error.message, 'docker restart lobe-postgres\nnpm.cmd run db:migrate');
    }

    try {
      const libraries = run('docker', [
        'exec',
        'lobe-postgres',
        'psql',
        '-U',
        dbUser,
        '-d',
        dbName,
        '-tAc',
        'SHOW shared_preload_libraries;',
      ]);
      if (libraries.split(',').map((item) => item.trim()).includes('pg_search')) {
        ok('pg_search preload', libraries);
      } else {
        fail(
          'pg_search preload',
          `shared_preload_libraries=${libraries || '<empty>'}`,
          'Recreate lobe-postgres with: -c shared_preload_libraries=pg_search',
        );
      }
    } catch (error) {
      fail('pg_search preload', error.message, postgresRepair);
    }

    try {
      const exists = run('docker', [
        'exec',
        'lobe-postgres',
        'psql',
        '-U',
        dbUser,
        '-d',
        dbName,
        '-tAc',
        "SELECT to_regclass('public.auth_sessions') IS NOT NULL;",
      ]);
      if (exists === 't') {
        ok('auth_sessions table', 'public.auth_sessions exists.');
      } else {
        fail('auth_sessions table', 'public.auth_sessions is missing.', 'npm.cmd run db:migrate');
      }
    } catch (error) {
      fail('auth_sessions table', error.message, 'npm.cmd run db:migrate');
    }
  }

  try {
    const minio = findContainer((item) =>
      `${item.name} ${item.image}`.toLowerCase().includes('minio'),
    );
    if (minio) {
      ok('MinIO container', `${minio.name} (${minio.image})`);
    } else {
      fail(
        'MinIO container',
        'No running MinIO container found.',
        'Start the local MinIO container, then confirm ports 9000/9001 are available.',
      );
    }
  } catch {
    // Docker failure is already reported above.
  }

  if (await testPort(nextPort)) {
    ok(`Next port ${nextPort}`, `127.0.0.1:${nextPort} is listening.`);
  } else {
    fail(`Next port ${nextPort}`, `Next is not listening on ${nextPort}.`, 'npm.cmd run dev');
  }

  if (await testPort(vitePort)) {
    ok(`Vite SPA port ${vitePort}`, `127.0.0.1:${vitePort} is listening.`);
  } else {
    fail(
      `Vite SPA port ${vitePort}`,
      `Vite SPA is not listening on ${vitePort}. Running only next dev will cause / to return 500.`,
      'npm.cmd run dev',
    );
  }

  console.log('\nHeyang local preflight\n');
  for (const check of checks) {
    const mark = check.ok ? '[OK]' : '[FAIL]';
    console.log(`${mark} ${check.name}${check.detail ? ` - ${check.detail}` : ''}`);
    if (!check.ok && check.fix) console.log(`      Fix:\n${check.fix.replace(/^/gm, '        ')}`);
  }

  const failures = checks.filter((item) => !item.ok);
  if (failures.length > 0) {
    console.error(`\nPreflight failed: ${failures.length} check(s) need attention.`);
    process.exit(1);
  }

  console.log('\nPreflight passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
