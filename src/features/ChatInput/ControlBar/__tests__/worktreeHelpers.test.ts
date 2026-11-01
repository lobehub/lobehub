import type { DeviceGitWorktreeListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { findWorktreeForBranch } from '../worktreeHelpers';

const worktree = (
  overrides: Partial<DeviceGitWorktreeListItem> & Pick<DeviceGitWorktreeListItem, 'path'>,
): DeviceGitWorktreeListItem => ({ ...overrides }) as DeviceGitWorktreeListItem;

describe('findWorktreeForBranch', () => {
  it('resolves the linked worktree holding the branch', () => {
    const worktrees = [
      worktree({ branch: 'main', current: true, path: '/repo' }),
      worktree({ branch: 'feat/x', path: '/repo-wt' }),
    ];

    expect(findWorktreeForBranch(worktrees, 'feat/x')?.path).toBe('/repo-wt');
  });

  it('ignores the current worktree, since checking out its branch is a no-op', () => {
    const worktrees = [worktree({ branch: 'main', current: true, path: '/repo' })];

    expect(findWorktreeForBranch(worktrees, 'main')).toBeUndefined();
  });

  it('ignores bare and prunable worktrees, which have no checkout to switch into', () => {
    const worktrees = [
      worktree({ bare: true, branch: 'feat/x', path: '/repo-bare' }),
      worktree({ branch: 'feat/y', path: '/repo-gone', prunable: true }),
    ];

    expect(findWorktreeForBranch(worktrees, 'feat/x')).toBeUndefined();
    expect(findWorktreeForBranch(worktrees, 'feat/y')).toBeUndefined();
  });

  it('returns undefined for a free branch, which checks out in place', () => {
    const worktrees = [worktree({ branch: 'main', current: true, path: '/repo' })];

    expect(findWorktreeForBranch(worktrees, 'feat/unheld')).toBeUndefined();
  });

  it('does not match a detached worktree that merely sits on the branch tip', () => {
    const worktrees = [
      worktree({ branch: 'main', current: true, path: '/repo' }),
      worktree({ detached: true, head: 'abc1234', path: '/repo-detached' }),
    ];

    expect(findWorktreeForBranch(worktrees, 'feat/x')).toBeUndefined();
  });
});
