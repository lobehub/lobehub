import type { DeviceGitWorktreeListItem } from '@lobechat/types';

export const getPathName = (path: string): string =>
  path.replaceAll('\\', '/').split('/').findLast(Boolean) || path;

export const normalizeDisplayPath = (path: string): string =>
  path.replaceAll('\\', '/').replace(/\/+$/, '');

/** Bare and prunable worktrees have no usable checkout to switch into. */
export const isDisabled = (worktree: DeviceGitWorktreeListItem): boolean =>
  !!worktree.bare || !!worktree.prunable;

/**
 * Git allows a branch to be checked out in at most one worktree, so `git
 * checkout <branch>` fails with "is already checked out at ..." whenever another
 * worktree holds it. Resolve that owner up-front to route into it instead of
 * letting the checkout fail — matching on the parsed `branch` field rather than
 * on git's stderr, which is version- and locale-dependent.
 *
 * The current worktree is never the answer: a branch it holds is the current
 * branch, and checking that out is a no-op the caller short-circuits earlier.
 */
export const findWorktreeForBranch = (
  worktrees: DeviceGitWorktreeListItem[],
  branch: string,
): DeviceGitWorktreeListItem | undefined =>
  worktrees.find(
    (worktree) => !worktree.current && !isDisabled(worktree) && worktree.branch === branch,
  );
