import type { GitWorkingTreePatches } from '@lobechat/electron-client-ipc';
import type {
  DeviceExecutionTarget,
  DeviceGitPullRequestCiStatus,
  DeviceGitWorktreeListItem,
} from '@lobechat/types';

import { normalizeDisplayPath } from '@/features/ChatInput/ControlBar/worktreeHelpers';

/** macOS aliases `/tmp` & `/var` onto `/private/...`; git reports the real path
 * while the picked working directory keeps the alias, so strip the prefix
 * before comparing or a main-worktree checkout under /tmp reads as linked. */
const stripPrivateAlias = (path: string) => path.replace(/^\/private(?=\/(?:tmp|var)\/)/, '');

export interface OverviewChangeStats {
  additions: number;
  deletions: number;
  files: number;
}

/** Aggregate the working-tree ± counts across the repo and its submodules. */
export const collectChangeStats = (reviewData?: GitWorkingTreePatches): OverviewChangeStats => {
  const patches = [
    ...(reviewData?.patches ?? []),
    ...(reviewData?.submodules ?? []).flatMap((submodule) => submodule.patches),
  ];

  return patches.reduce(
    (stats, patch) => ({
      additions: stats.additions + (patch.additions ?? 0),
      deletions: stats.deletions + (patch.deletions ?? 0),
      files: stats.files + 1,
    }),
    { additions: 0, deletions: 0, files: 0 },
  );
};

/**
 * Whether the current checkout is a LINKED worktree. `git worktree list` always
 * emits the main worktree first (a bare repo has none, so every checkout is
 * linked) — compare against it rather than any sourcePath, which is itself a
 * linked worktree whenever the user picked one directly (see WorktreeSwitcher).
 */
export const isLinkedWorktreeCheckout = (
  workingDirectory: string | undefined,
  worktrees: DeviceGitWorktreeListItem[],
): boolean => {
  const [mainWorktree] = worktrees;
  return (
    !!workingDirectory &&
    !!mainWorktree &&
    (!!mainWorktree.bare ||
      stripPrivateAlias(normalizeDisplayPath(workingDirectory)) !==
        stripPrivateAlias(normalizeDisplayPath(mainWorktree.path)))
  );
};

/**
 * Passing checks are the steady state and stay icon-only; only a failing or
 * still-running rollup earns a text label next to the PR row.
 */
export const shouldShowCiLabel = (status?: DeviceGitPullRequestCiStatus): boolean =>
  status === 'failure' || status === 'pending';

/**
 * The machine whose live status the Overview shows. Unlike the RPC routing id,
 * which is empty for "This device" so file and git reads stay on Electron IPC,
 * a local run still names the desktop it is bound to, and that machine has a
 * device card like any other.
 */
export const getStatusDeviceId = (
  target: DeviceExecutionTarget,
  boundDeviceId: string | undefined,
): string | undefined => (target === 'device' || target === 'local' ? boundDeviceId : undefined);

/**
 * The git section skeleton is a first-ever-load affordance only. Once any git
 * read has data — live, or hydrated from the replica's persisted rows on
 * reload — the rows render stale-first and the in-flight reads refresh them in
 * place.
 */
export const shouldShowGitSkeleton = ({
  hasData,
  loading,
}: {
  hasData: boolean;
  loading: boolean;
}): boolean => loading && !hasData;
