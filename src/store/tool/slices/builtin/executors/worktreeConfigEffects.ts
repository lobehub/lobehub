import type { DeviceGitUpstreamRef, WorkingDirConfig } from '@lobechat/types';
import { dropStaleAutoCreated } from '@lobechat/types';

/**
 * How each detected git / gh side effect rewrites a topic's working-directory
 * config. Pure reducers, so `worktreeDetection` decides WHAT happened and these
 * decide what the topic records about it.
 */

export interface WorktreeAddInfo {
  branch?: string;
  path: string;
}

export const applyBranchToConfig = (
  currentConfig: WorkingDirConfig | undefined,
  source: string,
  branch: string,
): WorkingDirConfig => {
  const branchChanged = currentConfig?.git?.branch !== branch;
  const git: NonNullable<WorkingDirConfig['git']> = {
    ...currentConfig?.git,
    branch,
  };

  delete git.detached;
  // The old branch's remote ref and PR describe a branch the topic has left. Held
  // onto, `upstream` would aim the PR lookup at the wrong head — worse than none.
  if (branchChanged) {
    delete git.github;
    delete git.upstream;
  }

  return {
    ...currentConfig,
    git,
    path: source,
    ...(currentConfig?.repoType ? { repoType: currentConfig.repoType } : {}),
  };
};

export const applyDetachedToConfig = (
  currentConfig: WorkingDirConfig | undefined,
  source: string,
): WorkingDirConfig => {
  const git: NonNullable<WorkingDirConfig['git']> = {
    ...currentConfig?.git,
    detached: true,
  };

  delete git.branch;
  delete git.github;
  delete git.upstream;

  return {
    ...currentConfig,
    git,
    path: source,
    ...(currentConfig?.repoType ? { repoType: currentConfig.repoType } : {}),
  };
};

/**
 * Record where the branch now publishes to. This is what makes the PR lookup work at
 * all for a worktree: its local branch name (`worktree-feat+x`) never exists on the
 * remote, so only the ref the push actually created (`feat/y`) can find the PR.
 */
export const applyPushToConfig = (
  currentConfig: WorkingDirConfig | undefined,
  source: string,
  upstream: DeviceGitUpstreamRef,
): WorkingDirConfig => {
  const previous = currentConfig?.git?.upstream?.branch;
  const git: NonNullable<WorkingDirConfig['git']> = {
    ...currentConfig?.git,
    upstream,
  };

  // Re-pointing the branch at a DIFFERENT remote ref orphans a PR an older client
  // recorded for the old one. Only a change invalidates it.
  if (previous && previous !== upstream.branch) delete git.github;

  return {
    ...currentConfig,
    git,
    path: source,
    ...(currentConfig?.repoType ? { repoType: currentConfig.repoType } : {}),
  };
};

export const applyWorktreeAddToConfig = (
  currentConfig: WorkingDirConfig | undefined,
  source: string,
  info: WorktreeAddInfo,
): WorkingDirConfig => {
  const branchChanged = !!info.branch && currentConfig?.git?.branch !== info.branch;
  const git: NonNullable<WorkingDirConfig['git']> = {
    ...currentConfig?.git,
    activeWorktree: info.path,
    ...(info.branch ? { branch: info.branch } : {}),
    isWorktree: true,
  };

  if (info.branch) delete git.detached;
  if (branchChanged) {
    delete git.github;
    delete git.upstream;
  }
  dropStaleAutoCreated(git, currentConfig?.git?.activeWorktree);

  return {
    ...currentConfig,
    git,
    path: source,
    ...(currentConfig?.repoType ? { repoType: currentConfig.repoType } : {}),
  };
};

/**
 * The session left the worktree and is back in the source repo. `branch`, its
 * `upstream` ref and the linked `github` PR described the worktree's branch, not the
 * source repo's, so they are dropped rather than left pointing at a branch the topic
 * is no longer on — the source branch is unknown until the next `git switch` /
 * `checkout` refreshes it.
 */
export const applyWorktreeExitToConfig = (
  currentConfig: WorkingDirConfig | undefined,
  source: string,
  { removed = false }: { removed?: boolean } = {},
): WorkingDirConfig => {
  const git: NonNullable<WorkingDirConfig['git']> = {
    ...currentConfig?.git,
    isWorktree: false,
  };

  // A worktree picked by hand records no `isWorktree` flag — a distinct
  // `activeWorktree` is evidence enough that branch / upstream / PR were its own.
  const activeWorktree = currentConfig?.git?.activeWorktree;
  const leftWorktree =
    !!currentConfig?.git?.isWorktree || (!!activeWorktree && activeWorktree !== source);
  delete git.activeWorktree;
  dropStaleAutoCreated(git, activeWorktree);
  if (leftWorktree) {
    delete git.branch;
    delete git.github;
    delete git.upstream;
  }

  // A topic born in the app's worktree runs its CLI there (`sessionPath`), not
  // in the source. Leaving ANOTHER worktree returns it there; removing that very
  // worktree leaves nothing to start in, so the session falls back to the source.
  const { sessionPath, ...rest } = currentConfig ?? ({} as Partial<WorkingDirConfig>);
  const sessionGone = !!sessionPath && removed && sessionPath === activeWorktree;
  if (sessionPath && !sessionGone && sessionPath !== activeWorktree) {
    git.activeWorktree = sessionPath;
    git.isWorktree = true;
  }

  return {
    ...rest,
    git,
    path: source,
    ...(currentConfig?.repoType ? { repoType: currentConfig.repoType } : {}),
    ...(sessionPath && !sessionGone ? { sessionPath } : {}),
  };
};
