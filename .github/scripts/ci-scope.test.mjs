import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  affectedTestPackages,
  computeScope,
  EXCLUDED_TEST_PACKAGES,
  FULL_LABEL,
  MAX_AFFECTED_FILES,
  parseNameStatus,
  readWorkspace,
  testPackages,
} from './ci-scope.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const workspace = new Map([
  ['@lobechat/types', { dir: 'packages/types', deps: [], hasTest: true }],
  ['@lobechat/utils', { dir: 'packages/utils', deps: ['@lobechat/types'], hasTest: true }],
  [
    '@lobechat/database',
    { dir: 'packages/database', deps: ['@lobechat/utils', '@lobechat/types'], hasTest: true },
  ],
  ['@lobechat/editor', { dir: 'packages/editor', deps: [], hasTest: true }],
  ['@lobechat/openapi', { dir: 'packages/openapi', deps: [], hasTest: true }],
  ['@lobehub/sdk', { dir: 'packages/sdk', deps: ['@lobechat/openapi'], hasTest: true }],
  ['@lobechat/no-tests', { dir: 'packages/no-tests', deps: ['@lobechat/types'], hasTest: false }],
  ['@lobechat/local-file-shell', { dir: 'packages/local-file-shell', deps: [], hasTest: true }],
  ['@lobechat/business-const', { dir: 'packages/business/const', deps: [], hasTest: true }],
]);

const pr = (...paths) => ({
  changes: paths.map((entry) => (typeof entry === 'string' ? { status: 'M', path: entry } : entry)),
  eventName: 'pull_request',
  headRef: 'feat/something',
  labels: [],
  workspace,
});

const ran = (scope) =>
  ['app', 'server', 'packages', 'database', 'windowsShell', 'e2e', 'renderBudget'].filter(
    (flag) => scope[flag],
  );

test('pushes, labelled PRs, release branches and unlisted diffs run in full', () => {
  assert.equal(computeScope({ eventName: 'push', changes: null }).mode, 'full');
  assert.equal(computeScope({ eventName: 'workflow_dispatch', changes: null }).mode, 'full');
  assert.equal(computeScope({ ...pr('src/a.ts'), labels: [FULL_LABEL] }).mode, 'full');
  assert.equal(computeScope({ ...pr('src/a.ts'), headRef: 'release/weekly-1' }).mode, 'full');
  assert.equal(computeScope({ ...pr('src/a.ts'), headRef: 'hotfix/x' }).mode, 'full');
  assert.equal(computeScope({ ...pr(), changes: null }).mode, 'full');
  const many = Array.from({ length: MAX_AFFECTED_FILES + 1 }, (_, i) => `src/f${i}.ts`);
  assert.equal(computeScope(pr(...many)).mode, 'full');
  const scope = computeScope({ eventName: 'push', changes: null });
  assert.deepEqual(ran(scope).length, 7);
  assert.equal(scope.packageNames, null);
});

test('dependency, config, setup and workflow changes run in full', () => {
  for (const file of [
    'package.json',
    'packages/utils/package.json',
    'pnpm-workspace.yaml',
    'patches/foo.patch',
    'tsconfig.json',
    'vitest.config.mts',
    'plugins/vite/stylex.ts',
    '__mocks__/zustand/traditional.ts',
    'tests/setup.ts',
    'tests/setup.server.ts',
    'src/store/__snapshots__/a.test.ts.snap',
    'packages/x/src/__fixtures__/a.jsonl',
    '.github/workflows/test.yml',
    '.github/workflows/e2e.yml',
    '.github/actions/setup-env/action.yml',
    '.github/scripts/ci-scope.mjs',
  ]) {
    assert.equal(computeScope(pr(file)).mode, 'full', file);
  }
});

test('deleted or renamed source files run in full: a stale importer would not be selected', () => {
  assert.equal(computeScope(pr({ status: 'D', path: 'src/utils/a.ts' })).mode, 'full');
  assert.equal(
    computeScope(pr({ status: 'R100', from: 'packages/utils/src/a.ts', path: 'docs/a.ts' })).mode,
    'full',
  );
  assert.equal(computeScope(pr({ status: 'D', path: 'docs/old.md' })).mode, 'affected');
  assert.equal(computeScope(pr({ status: 'D', path: 'apps/desktop/src/a.ts' })).mode, 'affected');
});

test('files read from disk outside a package run in full; package data reruns that package', () => {
  assert.equal(computeScope(pr('packages/database/migrations/0100_x.sql')).mode, 'full');
  assert.equal(computeScope(pr('src/server/template.html')).mode, 'full');
  const openapi = computeScope(pr('packages/openapi/openapi.yml'));
  assert.equal(openapi.mode, 'affected');
  assert.deepEqual(openapi.packageNames, ['@lobechat/openapi', '@lobehub/sdk']);
  assert.deepEqual(ran(openapi), ['packages', 'e2e']);
});

test('docs, desktop and mobile changes need no unit-test or E2E job', () => {
  for (const file of [
    'docs/a.mdx',
    'README.md',
    'apps/desktop/src/main/a.ts',
    'apps/mobile/a.ts',
  ]) {
    const scope = computeScope(pr(file));
    assert.equal(scope.mode, 'affected', file);
    assert.deepEqual(ran(scope), [], file);
  }
});

test('app source runs the app, server and E2E jobs; a test-only change runs just its project', () => {
  assert.deepEqual(ran(computeScope(pr('src/features/a.tsx'))), [
    'app',
    'server',
    'e2e',
    'renderBudget',
  ]);
  assert.deepEqual(ran(computeScope(pr('src/features/a.test.tsx'))), ['app']);
  assert.deepEqual(ran(computeScope(pr('apps/server/src/a.ts'))), ['app', 'server', 'e2e']);
  assert.deepEqual(ran(computeScope(pr('apps/server/src/a.test.ts'))), ['server']);
  assert.deepEqual(ran(computeScope(pr('apps/workbench/src/a.ts'))), ['app', 'e2e']);
  assert.deepEqual(ran(computeScope(pr('e2e/src/steps/a.ts'))), ['e2e', 'renderBudget']);
  assert.deepEqual(ran(computeScope(pr('locales/zh-CN/chat.json'))), ['app', 'e2e']);
  assert.deepEqual(ran(computeScope(pr('apps/cli/src/a.ts'))), ['packages']);
  assert.deepEqual(ran(computeScope(pr('.github/scripts/pr-comment.js'))), ['packages']);
  assert.deepEqual(ran(computeScope(pr('public/favicon.ico'))), ['e2e', 'renderBudget']);
});

test('a package change selects it and its dependents, and the database only for its dependencies', () => {
  const types = computeScope(pr('packages/types/src/index.ts'));
  assert.deepEqual(ran(types), ['app', 'server', 'packages', 'database', 'e2e']);
  assert.deepEqual(types.packageNames, ['@lobechat/types', '@lobechat/utils']);

  const editor = computeScope(pr('packages/editor/src/Editor.tsx'));
  assert.deepEqual(ran(editor), ['app', 'server', 'packages', 'e2e', 'renderBudget']);
  assert.deepEqual(editor.packageNames, ['@lobechat/editor']);

  const dbTest = computeScope(pr('packages/database/src/models/a.test.ts'));
  assert.deepEqual(ran(dbTest), ['database']);
  assert.deepEqual(dbTest.packageNames, []);

  const nested = computeScope(pr('packages/business/const/src/index.ts'));
  assert.deepEqual(nested.packageNames, ['@lobechat/business-const']);

  assert.deepEqual(ran(computeScope(pr('packages/local-file-shell/src/a.test.ts'))), [
    'packages',
    'windowsShell',
  ]);
});

test('affectedTestPackages follows dependents transitively and drops packages without tests', () => {
  assert.deepEqual(affectedTestPackages(workspace, new Set(['@lobechat/types'])), [
    '@lobechat/types',
    '@lobechat/utils',
  ]);
  assert.deepEqual(affectedTestPackages(workspace, new Set(['@lobechat/no-tests'])), []);
});

test('parseNameStatus keeps both sides of a rename', () => {
  assert.deepEqual(parseNameStatus('M\tsrc/a.ts\nR087\tsrc/b.ts\tsrc/c.ts\nD\tsrc/d.ts\n'), [
    { status: 'M', path: 'src/a.ts' },
    { status: 'R087', from: 'src/b.ts', path: 'src/c.ts' },
    { status: 'D', path: 'src/d.ts' },
  ]);
});

test('the real workspace: every listed package exists, the database and exclusions stay out', () => {
  const real = readWorkspace(repoRoot);
  const names = testPackages(real);
  assert.ok(names.length > 30, `found ${names.length} test packages`);
  assert.ok(!names.includes('@lobechat/database'));
  for (const excluded of Object.keys(EXCLUDED_TEST_PACKAGES)) {
    assert.ok(real.has(excluded), `${excluded} still exists`);
    assert.ok(!names.includes(excluded));
  }
  // packages Test Packages ran before the list was derived from the workspace
  for (const name of [
    '@lobechat/model-runtime',
    '@lobechat/openapi',
    '@lobehub/sdk',
    'model-bank',
  ]) {
    assert.ok(names.includes(name), name);
  }
});
