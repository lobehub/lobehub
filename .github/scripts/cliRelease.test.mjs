import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { planRelease, readRegistry, verifyPublication } from './cliRelease.mjs';

const exec = promisify(execFile);
const registry = (version = '0.0.78', extra = {}) => ({
  'dist-tags': { latest: version },
  'versions': { [version]: {}, ...extra },
});
const plan = (overrides = {}) =>
  planRelease({
    sourceVersion: '0.0.78',
    metadata: registry(),
    reservations: [],
    sha: 'current',
    isAncestor: async () => false,
    ...overrides,
  });

test('increments the registry patch without a checked-in version bump', async () => {
  assert.deepEqual(await plan(), { publish: true, version: '0.0.79', reserved: false });
  assert.equal((await plan({ metadata: registry('0.0.99') })).version, '0.0.100');
  assert.equal((await plan({ sourceVersion: '0.1.0' })).version, '0.1.0');
  assert.equal((await plan({ sourceVersion: '0.0.1' })).version, '0.0.79');
});

test('allocates beyond every stable version even when latest was rolled back', async () => {
  assert.equal(
    (await plan({ metadata: registry('0.0.78', { '0.0.80': {}, '1.0.0-beta.1': {} }) })).version,
    '0.0.81',
  );
});

test('retries a reserved version while npm is still processing', async () => {
  assert.deepEqual(await plan({ reservations: [{ version: '0.0.79', sha: 'current' }] }), {
    publish: true,
    version: '0.0.79',
    reserved: true,
  });
});

test('skips a published commit and rejects a mismatched source', async () => {
  const reservations = [{ version: '0.0.79', sha: 'current' }];
  assert.equal(
    (
      await plan({
        reservations,
        metadata: registry('0.0.79', { '0.0.79': { gitHead: 'current' } }),
      })
    ).publish,
    false,
  );
  await assert.rejects(plan({ reservations, metadata: registry('0.0.79') }), /Source mismatch/);
});

test('retry still fails if the newest package is visible but latest is stale', async () => {
  const reservations = [{ version: '0.0.79', sha: 'current' }];
  const metadata = registry('0.0.78', { '0.0.79': { gitHead: 'current' } });
  await assert.rejects(plan({ reservations, metadata }), /latest does not point to/);
  assert.equal(
    (
      await plan({
        reservations,
        metadata: registry('0.0.80', { '0.0.79': { gitHead: 'current' } }),
      })
    ).publish,
    false,
  );
});

test('blocks a different commit behind an unfinished publication', async () => {
  await assert.rejects(
    plan({ reservations: [{ version: '0.0.79', sha: 'previous' }] }),
    /unfinished/,
  );
});

test('old workflow reruns cannot allocate a newer version or roll latest backwards', async () => {
  assert.equal(
    (
      await plan({
        reservations: [{ version: '0.0.79', sha: 'newer' }],
        isAncestor: async () => true,
      })
    ).publish,
    false,
  );
  assert.equal(
    (
      await plan({
        reservations: [{ version: '0.0.79', sha: 'current' }],
        metadata: registry('0.0.80'),
      })
    ).publish,
    false,
  );
});

test('rejects prereleases and malformed registry metadata', async () => {
  for (const sourceVersion of ['0.0.79-beta.1', '01.0.0', 'garbage'])
    await assert.rejects(plan({ sourceVersion }), /stable version/);
  for (const metadata of [
    {},
    { versions: {} },
    { 'versions': {}, 'dist-tags': { latest: '0.0.78' } },
  ]) {
    await assert.rejects(plan({ metadata }), /Registry/);
  }
});

test('does not interpret registry authentication, outage or malformed JSON as an unpublished version', async () => {
  for (const status of [401, 404, 500]) {
    await assert.rejects(
      readRegistry('@lobehub/cli', async () => new Response('', { status })),
      new RegExp(`HTTP ${status}`),
    );
  }
  await assert.rejects(
    readRegistry('@lobehub/cli', async () => new Response('not JSON')),
    /JSON/,
  );
});

test('waits for public registry visibility, verifies source and latest, and bounds pending publications', async () => {
  let calls = 0;
  const opts = {
    name: '@lobehub/cli',
    version: '0.0.79',
    sha: 'current',
    sleep: async () => {},
    attempts: 2,
  };
  await verifyPublication({
    ...opts,
    read: async () =>
      ++calls === 1 ? registry() : registry('0.0.79', { '0.0.79': { gitHead: 'current' } }),
  });
  assert.equal(calls, 2);
  await assert.rejects(
    verifyPublication({ ...opts, read: async () => registry() }),
    /not visible yet/,
  );
  await assert.rejects(
    verifyPublication({ ...opts, read: async () => registry('0.0.79') }),
    /Source mismatch/,
  );
  await assert.rejects(
    verifyPublication({
      ...opts,
      read: async () => registry('0.0.80', { '0.0.79': { gitHead: 'current' } }),
    }),
    /latest/,
  );
});

test('persists a reservation in Git, reuses it after a failed run, and skips after publication', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'cli-release-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const origin = path.join(root, 'origin.git');
  const checkout = path.join(root, 'checkout');
  await exec('git', ['init', '--bare', origin]);
  await exec('git', ['clone', origin, checkout]);
  const git = (...args) => exec('git', args, { cwd: checkout });
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Test');
  await mkdir(path.join(checkout, 'apps/cli'), { recursive: true });
  const pkgPath = path.join(checkout, 'apps/cli/package.json');
  const pkg = { name: '@lobehub/cli', version: '0.0.78' };
  await writeFile(pkgPath, JSON.stringify(pkg));
  await git('add', '.');
  await git('commit', '-m', 'source');
  const sha = (await git('rev-parse', 'HEAD')).stdout.trim();
  const script = pathToScript();
  const invoke = async (metadata) => {
    const runner = `
      const { prepareRelease, reserveRelease } = await import(process.argv[1]);
      const metadata = JSON.parse(process.argv[2]);
      const plan = await prepareRelease({ env: {}, read: async () => metadata });
      if (plan.publish) await reserveRelease();
    `;
    await exec(
      process.execPath,
      ['--input-type=module', '-e', runner, script, JSON.stringify(metadata)],
      {
        cwd: checkout,
      },
    );
  };
  await invoke(registry());
  const publishedPackage = JSON.parse(await readFile(pkgPath, 'utf8'));
  assert.equal(publishedPackage.version, '0.0.79');
  assert.equal(publishedPackage.gitHead, sha);
  assert.match((await git('ls-remote', '--tags', 'origin')).stdout, /cli-release\/v0\.0\.79/);
  await git('restore', 'apps/cli/package.json');
  await invoke(registry());
  assert.equal(JSON.parse(await readFile(pkgPath, 'utf8')).version, '0.0.79');
  assert.equal((await git('tag', '--list')).stdout.trim().split('\n').length, 1);
  await git('restore', 'apps/cli/package.json');
  await invoke(registry('0.0.79', { '0.0.79': { gitHead: sha } }));
  assert.deepEqual(JSON.parse(await readFile(pkgPath, 'utf8')), pkg);
});

function pathToScript() {
  return new URL('./cliRelease.mjs', import.meta.url).href;
}

test('workflow limits automatic publication to production inputs and serializes runs', async () => {
  // YAML is a repository dependency; importing lazily keeps pure planner tests standalone.
  const { parse } = await import('yaml');
  const workflow = parse(
    await readFile(fileURLToPath(new URL('../workflows/release-cli.yml', import.meta.url)), 'utf8'),
  );
  const patterns = workflow.on.push.paths;
  assert.ok(patterns.includes('apps/cli/src/**'));
  for (const excluded of [
    '!apps/cli/**/*.test.*',
    '!apps/cli/**/*.spec.*',
    '!apps/cli/**/__tests__/**',
    '!apps/cli/**/*.md',
  ])
    assert.ok(patterns.includes(excluded));
  const triggers = (file) =>
    patterns.reduce((included, pattern) => {
      const exclude = pattern.startsWith('!');
      return path.matchesGlob(file, exclude ? pattern.slice(1) : pattern) ? !exclude : included;
    }, false);
  for (const file of [
    'apps/cli/src/commands/agent.ts',
    'apps/cli/scripts/copyReportTemplate.ts',
    'apps/cli/package.json',
    'apps/cli/tsdown.config.ts',
  ])
    assert.equal(triggers(file), true, file);
  for (const file of [
    'apps/cli/README.md',
    'apps/cli/man/man1/lh.1',
    'apps/cli/src/commands/agent.test.ts',
    'apps/cli/src/x.spec.ts',
    'apps/cli/src/__tests__/integration.ts',
    'apps/cli/src/fixtures/data.json',
    'apps/cli/src/docs/guide.md',
    'apps/cli/e2e/agent.ts',
  ])
    assert.equal(triggers(file), false, file);
  assert.equal(workflow.concurrency.group, 'release-cli');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(workflow.jobs.publish.steps[0].with['fetch-depth'], 0);
  assert.match(workflow.jobs.publish.if, /refs\/heads\/canary/);
});
