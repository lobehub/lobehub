import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { shouldBuildDesktopCanary } = require('./desktopCanaryTrigger.cjs') as {
  shouldBuildDesktopCanary: (subject: string) => boolean;
};

describe('shouldBuildDesktopCanary', () => {
  it.each([
    'feat: add a feature',
    'fix(scope): repair a bug',
    '🔥 refactor(agentTasks): remove stale labels',
    '💄 feat(chat): resolve entity links',
    '🐛 perf(upload): hash files off the main thread',
  ])('accepts release commit type independently of gitmoji: %s', (subject) => {
    expect(shouldBuildDesktopCanary(subject)).toBe(true);
  });

  it.each([
    'chore: update dependencies',
    '🔥 chore: remove generated files',
    'docs(scope): update release docs',
    'chore: mention feat: in the release notes',
  ])('rejects non-release commit type: %s', (subject) => {
    expect(shouldBuildDesktopCanary(subject)).toBe(false);
  });
});
