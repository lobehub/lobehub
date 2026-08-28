import { describe, expect, it } from 'vitest';

import { resolveStaleSnapshot } from '../staleSnapshot';

// The recorded worktree gets deleted once its task is done, but the topic keeps
// pointing at it. The live git probe then reads nothing, so everything the bar
// can still show comes from this snapshot — including the way out of it.
const deadWorktree = {
  activeWorktree: '/tmp/lobehub-wt-subtask',
  branch: 'feat/task-list-subtask-nesting',
  github: {
    pullRequest: {
      number: 18_454,
      state: 'OPEN',
      title: 'PR #18454',
      url: 'https://github.com/lobehub/lobehub/pull/18454',
    },
    pullRequestStatus: 'ok' as const,
  },
  isWorktree: true,
};

describe('resolveStaleSnapshot', () => {
  it('surfaces the recorded branch, worktree and linked PR', () => {
    const view = resolveStaleSnapshot({ git: deadWorktree, path: '/tmp/lobehub-wt-subtask' });

    expect(view.branch).toBe('feat/task-list-subtask-nesting');
    expect(view.worktreePath).toBe('/tmp/lobehub-wt-subtask');
    expect(view.isWorktree).toBe(true);
    expect(view.pullRequest?.number).toBe(18_454);
  });

  it('names the missing worktree in the explanation', () => {
    const view = resolveStaleSnapshot({ git: deadWorktree, path: '/tmp/lobehub-wt-subtask' });

    expect(view.explanation).toEqual({
      key: 'workingDirectory.staleWorktreeSnapshot',
      values: { name: 'lobehub-wt-subtask' },
    });
  });

  it('offers a way back to the source repo, named after it', () => {
    const view = resolveStaleSnapshot({
      git: deadWorktree,
      path: '/tmp/lobehub-wt-subtask',
      sourcePath: '/Users/me/code/lobehub',
    });

    // Committing the source path is what drops `git.activeWorktree`, so the
    // target must be the repo root itself — not the dead checkout.
    expect(view.reset).toEqual({ name: 'lobehub', targetPath: '/Users/me/code/lobehub' });
  });

  it('offers no way back when the recorded source repo is itself the dead path', () => {
    const view = resolveStaleSnapshot({
      git: { branch: 'canary' },
      path: '/Users/me/code/gone',
      sourcePath: '/Users/me/code/gone',
    });

    // Nothing to fall back to: dropping the override would land on the same
    // missing directory, so recovery belongs to the directory picker.
    expect(view.reset).toBeUndefined();
    expect(view.explanation).toEqual({ key: 'workingDirectory.staleSnapshot' });
    expect(view.isWorktree).toBe(false);
  });

  it('treats a checkout that differs from the source as a worktree even without the flag', () => {
    // Older topics were persisted before `isWorktree` existed; the paths still
    // tell us it was a linked checkout.
    const view = resolveStaleSnapshot({
      git: { activeWorktree: '/tmp/wt-legacy', branch: 'fix/x' },
      path: '/tmp/wt-legacy',
      sourcePath: '/Users/me/code/lobehub',
    });

    expect(view.isWorktree).toBe(true);
    expect(view.explanation.values).toEqual({ name: 'wt-legacy' });
    expect(view.reset?.targetPath).toBe('/Users/me/code/lobehub');
  });
});
