import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveTestScopes } from './test-ci-scope.mjs';

const only = (...scopes) => ({
  app: scopes.includes('app'),
  desktop: scopes.includes('desktop'),
  packages: scopes.includes('packages'),
  server: scopes.includes('server'),
  windows: scopes.includes('windows'),
});

const ALL = only('app', 'server', 'packages', 'desktop', 'windows');

test('desktop-only change runs only the desktop job', () => {
  assert.deepEqual(
    resolveTestScopes(['apps/desktop/src/main/index.ts', 'apps/desktop/package.json']),
    only('desktop'),
  );
});

test('CLI-only change runs only the packages job', () => {
  assert.deepEqual(resolveTestScopes(['apps/cli/src/commands/doc.ts']), only('packages'));
});

test('share/workbench/auth changes run only the app project', () => {
  assert.deepEqual(
    resolveTestScopes(['apps/share/src/index.ts', 'apps/workbench/src/a.tsx', 'apps/auth/x.ts']),
    only('app'),
  );
});

test('src and apps/server changes run the app/server/packages trio', () => {
  const trio = only('app', 'server', 'packages');
  assert.deepEqual(resolveTestScopes(['src/store/chat/index.ts']), trio);
  assert.deepEqual(resolveTestScopes(['apps/server/src/routers/lambda/index.ts']), trio);
  assert.deepEqual(resolveTestScopes(['locales/zh-CN/chat.json']), trio);
});

test('package changes also run the desktop job', () => {
  assert.deepEqual(
    resolveTestScopes(['packages/database/src/models/topic.ts']),
    only('app', 'server', 'packages', 'desktop'),
  );
});

test('local-file-shell changes run the Windows shell verification', () => {
  assert.deepEqual(resolveTestScopes(['packages/local-file-shell/src/index.ts']), ALL);
});

test('docs, e2e and unrelated workflow changes run nothing', () => {
  assert.deepEqual(
    resolveTestScopes([
      'docs/usage/start.mdx',
      'README.md',
      'e2e/src/steps/chat.steps.ts',
      '.github/workflows/e2e.yml',
      '.agents/skills/react/SKILL.md',
    ]),
    only(),
  );
});

test('alint changes run only the desktop job that hosts alint', () => {
  assert.deepEqual(
    resolveTestScopes(['alint.config.toml', 'packages/alint/rules/foo.md', 'packages/alint/x.ts']),
    only('desktop'),
  );
});

test('scripts and docker-compose run only the app project', () => {
  assert.deepEqual(
    resolveTestScopes(['scripts/elasticsearchReindex/index.ts', 'docker-compose/setup.sh']),
    only('app'),
  );
  assert.deepEqual(resolveTestScopes(['scripts/vercelIgnoredBuildStep.js']), only('packages'));
});

test('lint-only config changes leave lint to the always-on database job', () => {
  assert.deepEqual(resolveTestScopes(['eslint.config.mjs', '.prettierignore']), only());
});

test('Test CI plumbing and unclassified root files run everything', () => {
  assert.deepEqual(resolveTestScopes(['.github/workflows/test.yml']), ALL);
  assert.deepEqual(resolveTestScopes(['.github/actions/setup-env/action.yml']), ALL);
  assert.deepEqual(resolveTestScopes(['pnpm-lock.yaml']), ALL);
  assert.deepEqual(resolveTestScopes(['package.json']), ALL);
  assert.deepEqual(resolveTestScopes(['vitest.config.mts']), ALL);
  assert.deepEqual(resolveTestScopes(['patches/foo.patch']), ALL);
});

test('mixed changes take the union', () => {
  assert.deepEqual(
    resolveTestScopes(['apps/desktop/src/main/a.ts', 'apps/cli/src/b.ts', 'docs/c.mdx']),
    only('desktop', 'packages'),
  );
});
