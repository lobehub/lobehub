import type { GitWorkingTreePatches } from '@lobechat/electron-client-ipc';
import type { DeviceGitWorktreeListItem } from '@lobechat/types';

import type { CiStatusKey } from '@/features/AgentSidebar/Topic/List/Item/metaCardData';
import { normalizeDisplayPath } from '@/features/ChatInput/ControlBar/worktreeHelpers';

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
      normalizeDisplayPath(workingDirectory) !== normalizeDisplayPath(mainWorktree.path))
  );
};

/**
 * Passing checks are the steady state and stay icon-only; only a failing or
 * still-running rollup earns a text label next to the PR row.
 */
export const shouldShowCiLabel = (ciKey: CiStatusKey): boolean =>
  ciKey === 'failure' || ciKey === 'pending';
