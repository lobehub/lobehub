import type { EnvironmentSource } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { isBuildable } from './instanceOperations';

const repo: EnvironmentSource = { kind: 'git', url: 'https://github.com/org/app' };
const localRepo: EnvironmentSource = { ...repo, localOnly: true };

describe('isBuildable', () => {
  it('builds a definition that clones a repository or runs setup', () => {
    expect(isBuildable({ sources: [repo] })).toBe(true);
    expect(isBuildable({ bootstrapCommand: 'pnpm i', sources: [] })).toBe(true);
    expect(isBuildable({ sources: [] })).toBe(false);
    expect(isBuildable(null)).toBe(false);
  });

  it('has nothing to build when every repository is local-only', () => {
    expect(isBuildable({ sources: [localRepo] })).toBe(false);
    expect(isBuildable({ sources: [localRepo, repo] })).toBe(true);
    expect(isBuildable({ bootstrapCommand: 'make', sources: [localRepo] })).toBe(true);
  });
});
