// @vitest-environment node
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const { isNonRuntimePath } = createRequire(import.meta.url)('./vercelIgnoredBuildStep.js') as {
  isNonRuntimePath: (filePath: string) => boolean;
};

describe('isNonRuntimePath', () => {
  it.each([
    'README.md',
    'CHANGELOG.mdx',
    '.github/workflows/test.yml',
    '.agents/skills/pr/SKILL.md',
    '.claude/settings.json',
    'docs/usage/start.mdx',
    'e2e/src/steps/login.ts',
    'src/features/Foo/index.test.tsx',
    'packages/database/src/models/__tests__/agent.test.ts',
    'packages/utils/src/__snapshots__/format.test.ts.snap',
  ])('skips %s', (file) => {
    expect(isNonRuntimePath(file)).toBe(true);
  });

  it.each([
    'src/app/page.tsx',
    'packages/agent-templates/src/templates/claw/SOUL.md',
    'packages/builtin-skills/src/task/SKILL.md',
    'scripts/migrateServerDB/index.ts',
    'package.json',
  ])('builds for %s', (file) => {
    expect(isNonRuntimePath(file)).toBe(false);
  });
});
