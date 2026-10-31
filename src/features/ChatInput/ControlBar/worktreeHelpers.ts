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

export const getShortSha = (sha: string): string => sha.slice(0, 8);

/**
 * The base a new worktree forks from by default: the source checkout's current
 * branch and HEAD, read off its `git worktree list` record. `value` is what the
 * base field starts with — the branch, or the short SHA when HEAD is detached.
 */
export interface WorktreeBaseDefault {
  branch?: string;
  detached?: boolean;
  sha?: string;
  value: string;
}

export const getWorktreeBaseDefault = (
  worktree: DeviceGitWorktreeListItem | undefined,
  fallbackBranch: string,
): WorktreeBaseDefault => {
  const sha = worktree?.head;
  if (worktree?.detached && sha) return { detached: true, sha, value: getShortSha(sha) };

  const branch = worktree?.branch ?? (fallbackBranch || undefined);
  return { branch, sha, value: branch ?? (sha ? getShortSha(sha) : '') };
};

/**
 * Translation inputs for a worktree's fork point: `based on <default>` when it
 * still sits on the default branch's tip, `based on <default>@<sha>` otherwise.
 */
export const getForkPointLabelArgs = (
  forkPoint: NonNullable<DeviceGitWorktreeListItem['forkPoint']>,
):
  | { key: 'workingDirectory.worktreeForkPointAtTip'; values: { branch: string } }
  | { key: 'workingDirectory.worktreeForkPoint'; values: { branch: string; sha: string } } =>
  forkPoint.atTip
    ? { key: 'workingDirectory.worktreeForkPointAtTip', values: { branch: forkPoint.baseBranch } }
    : {
        key: 'workingDirectory.worktreeForkPoint',
        values: { branch: forkPoint.baseBranch, sha: getShortSha(forkPoint.sha) },
      };
