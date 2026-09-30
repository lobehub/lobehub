const assert = require('node:assert/strict');
const { test } = require('node:test');

const { isFullRunTrigger, planAffectedTests, shardsFor } = require('./plan-affected-tests.cjs');

const fakeRun =
  ({ changed, specs = [], affected = [] }) =>
  (command) => {
    if (command === 'git') return changed.join('\n');
    if (command === 'pnpm') return JSON.stringify(affected.map((name) => ({ name })));
    return JSON.stringify(specs);
  };

const specsOf = (app, server) => [
  ...Array.from({ length: app }, () => ({ projectName: 'app' })),
  ...Array.from({ length: server }, () => ({ projectName: 'server' })),
];

test('runs everything without a merge base', () => {
  const plan = planAffectedTests({ base: '', packages: ['a'] });
  assert.equal(plan.mode, 'full');
  assert.deepEqual(plan.appShards, [1, 2, 3]);
  assert.deepEqual(plan.serverShards, [1, 2]);
  assert.deepEqual(plan.packages, ['a']);
  assert.equal(plan.windowsShell, true);
});

test('runs everything when an input outside the import graph changed', () => {
  for (const file of ['pnpm-lock.yaml', 'package.json', 'vitest.config.mts', 'tests/setup.ts']) {
    const plan = planAffectedTests({
      base: 'base',
      packages: ['a'],
      run: fakeRun({ changed: ['src/a.ts', file] }),
    });
    assert.equal(plan.mode, 'full', file);
  }
});

test('nested package manifests do not force a full run', () => {
  assert.equal(isFullRunTrigger('apps/desktop/package.json'), false);
  assert.equal(isFullRunTrigger('packages/utils/tsconfig.json'), false);
});

test('sizes shards from the affected test count', () => {
  const plan = planAffectedTests({
    base: 'base',
    packages: ['@lobechat/utils', '@lobechat/types'],
    run: fakeRun({
      affected: ['@lobehub/lobehub', '@lobechat/utils'],
      changed: ['packages/utils/src/a.ts'],
      specs: specsOf(677, 200),
    }),
  });
  assert.equal(plan.mode, 'affected');
  assert.deepEqual(plan.appShards, [1, 2]);
  assert.deepEqual(plan.serverShards, [1]);
  assert.deepEqual(plan.packages, ['@lobechat/utils']);
  assert.equal(plan.windowsShell, false);
});

test('skips suites with no affected tests', () => {
  const plan = planAffectedTests({
    base: 'base',
    packages: ['@lobechat/utils'],
    run: fakeRun({
      affected: ['@lobechat/local-file-shell'],
      changed: ['.github/workflows/x.yml'],
    }),
  });
  assert.deepEqual(plan.appShards, []);
  assert.deepEqual(plan.serverShards, []);
  assert.deepEqual(plan.packages, []);
  assert.equal(plan.windowsShell, true);
});

test('caps shards at the full-run layout', () => {
  assert.deepEqual(shardsFor(1495, 500, 3), [1, 2, 3]);
  assert.deepEqual(shardsFor(5000, 400, 2), [1, 2]);
  assert.deepEqual(shardsFor(0, 500, 3), []);
});
