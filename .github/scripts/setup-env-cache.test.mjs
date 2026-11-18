import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const load = async (path) => parse(await readFile(new URL(path, import.meta.url), 'utf8'));

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const dependencyPaths = (node) =>
  String(node.with['cache-dependency-path'] ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/** CI only checks out tracked files, so a gitignored file hashes to nothing there. */
const isIgnored = (file) => {
  try {
    execFileSync('git', ['check-ignore', '--quiet', file], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
};

test('setup-env caches the pnpm store from files CI actually checks out', async () => {
  const { runs } = await load('../actions/setup-env/action.yml');
  const node = runs.steps.find((step) => step.uses === 'actions/setup-node@v6');
  const paths = dependencyPaths(node);

  // setup-node caches pnpm only when `cache` is set; its automatic caching is npm-only.
  assert.equal(node.with.cache, 'pnpm');
  assert.ok(
    paths.some((path) => path.endsWith('package.json')),
    'the key follows dependency declarations',
  );
  for (const file of paths.filter((path) => !path.includes('*'))) {
    assert.ok(!isIgnored(file), `${file} is gitignored, so CI would hash nothing`);
  }
});

test('the overlay composites leave the store cache to setup-env', async () => {
  for (const action of ['overlay-type-check', 'desktop-build-setup']) {
    const { runs } = await load(`../actions/${action}/action.yml`);
    const ownCache = runs.steps.find((step) => String(step.uses ?? '').startsWith('actions/cache'));
    const storeDir = runs.steps.find((step) => String(step.run ?? '').includes('--store-dir'));

    assert.ok(
      runs.steps.some((step) => step.uses === './.github/actions/setup-env'),
      `${action} must set up the environment that caches the store`,
    );
    // A second cache step or store override would cache the same content twice.
    assert.equal(ownCache, undefined, `${action} must not cache its own store`);
    assert.equal(storeDir, undefined, `${action} must use the cached default store`);
  }
});
