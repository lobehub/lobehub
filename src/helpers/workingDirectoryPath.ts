import type { WorkingDirConfig, WorkingDirGitState, WorkingDirRepoType } from '@lobechat/types';

import { isDesktop } from '@/const/version';

/**
 * The persisted repo type for a working-dir config, applying the web default:
 * on web there is no local filesystem to probe, so an unset type on an EXISTING
 * config is treated as `github` (the only web-supported repo source); on desktop
 * it stays `undefined` so callers fall back to a live probe.
 *
 * No config at all means "nothing was ever persisted" — that must stay
 * `undefined` on every platform, otherwise a web caller would treat any bare
 * device cwd as a GitHub repo and fire git/PR probes at directories that were
 * never identified as one.
 *
 * Shared by the topic meta hover card and the ControlBar git status so both read
 * repoType from the same source instead of diverging.
 */
export const getConfigRepoType = (config?: WorkingDirConfig): WorkingDirRepoType | undefined => {
  if (!config) return undefined;

  return config.repoType ?? (isDesktop ? undefined : 'github');
};

export const getWorkingDirectoryPathString = (path?: string | null) => {
  const value = path?.trim();
  return value || undefined;
};

// Last non-empty path segment — the folder name. Also yields the repo name for
// a web github URL (".../owner/repo" -> "repo").
export const getWorkingDirectoryName = (path?: string | null) => {
  const value = getWorkingDirectoryPathString(path);
  if (!value) return;

  return value.replaceAll('\\', '/').split('/').findLast(Boolean) || value;
};

/**
 * Whether the effective checkout is a linked worktree rather than the source
 * repo itself. `isWorktree` is only stamped by the newer snapshot writer, so
 * topics recorded before it exist fall back to comparing the two paths.
 *
 * Shared by the topic meta hover card and the ControlBar's stale snapshot so a
 * topic can't be a worktree on one surface and a plain checkout on the other.
 */
export const isWorktreeCheckout = ({
  effectivePath,
  git,
  sourcePath,
}: {
  effectivePath?: string;
  git?: WorkingDirGitState;
  sourcePath?: string;
}): boolean =>
  !!git?.isWorktree || (!!sourcePath && !!effectivePath && effectivePath !== sourcePath);

/**
 * The effective checkout is back to the source repo: drop the worktree
 * override. `branch`, its `upstream` ref and the linked `github` PR described
 * the worktree's branch, not the source repo's, so they are dropped rather than
 * left pointing at a branch the topic is no longer on — the source branch is
 * unknown until the next `git switch` / `checkout` refreshes it.
 *
 * The single funnel for un-setting a worktree, shared by the `ExitWorktree`
 * recorder (the session walked out of it) and the run-start prune (the
 * directory was deleted underneath it), so the two cannot drift into recording
 * different shapes for the same state.
 */
export const applyWorktreeExitToConfig = (
  currentConfig: WorkingDirConfig | undefined,
  source: string,
): WorkingDirConfig => {
  const currentGit = currentConfig?.git;
  const git: NonNullable<WorkingDirConfig['git']> = { ...currentGit, isWorktree: false };

  // `isWorktree` is only stamped by the newer snapshot writer, so a topic
  // recorded before it carries `{ activeWorktree, branch, github }` and nothing
  // else. Keying the cleanup off that flag alone left those configs pointing at
  // the source repo while still advertising the abandoned worktree's branch and
  // PR — the same pre-flag shape `staleSnapshot` already reads by comparing
  // paths. Leaving the override is what makes it a worktree, flag or not.
  const wasWorktree =
    !!currentGit?.isWorktree ||
    (!!currentGit?.activeWorktree && currentGit.activeWorktree !== source);

  delete git.activeWorktree;
  if (wasWorktree) {
    delete git.branch;
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
