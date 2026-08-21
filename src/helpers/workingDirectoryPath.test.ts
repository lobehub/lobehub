import { describe, expect, it } from 'vitest';

import { applyWorktreeExitToConfig } from './workingDirectoryPath';

describe('applyWorktreeExitToConfig', () => {
  it('drops the worktree override and the branch context taken inside it', () => {
    const next = applyWorktreeExitToConfig(
      {
        git: {
          activeWorktree: '/repo-feat',
          branch: 'feat/x',
          github: { pullRequestStatus: 'ok' },
          isWorktree: true,
          upstream: { branch: 'feat/x', remote: 'origin' },
        },
        path: '/repo',
        repoType: 'github',
      },
      '/repo',
    );

    expect(next).toEqual({ git: { isWorktree: false }, path: '/repo', repoType: 'github' });
  });

  // Topics recorded before `isWorktree` existed carry only `{ activeWorktree,
  // branch, … }`. Gating the cleanup on the flag left them labelled with the
  // abandoned worktree's branch and PR while pointing at the source repo.
  it('drops the branch context for a pre-flag config that has no isWorktree', () => {
    const next = applyWorktreeExitToConfig(
      {
        git: {
          activeWorktree: '/tmp/wt-legacy',
          branch: 'fix/x',
          github: { pullRequestStatus: 'ok' },
          upstream: { branch: 'fix/x', remote: 'origin' },
        },
        path: '/repo',
      },
      '/repo',
    );

    expect(next).toEqual({ git: { isWorktree: false }, path: '/repo' });
  });

  // Nothing was overridden, so the recorded branch is the source repo's own.
  it('keeps the branch when the config was never in a worktree', () => {
    const next = applyWorktreeExitToConfig({ git: { branch: 'canary' }, path: '/repo' }, '/repo');

    expect(next).toEqual({ git: { branch: 'canary', isWorktree: false }, path: '/repo' });
  });
});
