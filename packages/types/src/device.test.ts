import { describe, expect, it } from 'vitest';

import { workingDirConfigSchema } from './device';

describe('workingDirConfigSchema', () => {
  it('preserves GitHub PR metadata under git.github', () => {
    const value = {
      git: {
        activeWorktree: '/repo-fix',
        branch: 'fix/worktree',
        github: {
          extraPullRequestCount: 1,
          pullRequest: {
            ciStatus: 'pending',
            isDraft: false,
            mergeStateStatus: 'CLEAN',
            mergeable: 'MERGEABLE',
            mergedAt: null,
            number: 123,
            reviewDecision: 'APPROVED',
            state: 'OPEN',
            title: 'Improve worktree handling',
            url: 'https://github.com/lobehub/lobehub/pull/123',
          },
          pullRequestStatus: 'ok',
        },
        isWorktree: true,
      },
      path: '/repo',
      repoType: 'github',
    };

    expect(workingDirConfigSchema.parse(value)).toEqual(value);
  });
});
