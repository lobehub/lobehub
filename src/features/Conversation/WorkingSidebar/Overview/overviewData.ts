import type { GitWorkingTreePatches } from '@lobechat/electron-client-ipc';
import type {
  DeviceExecutionTarget,
  DeviceGitPullRequestCiStatus,
  DeviceGitWorktreeListItem,
  OwnedWorktree,
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

/**
 * The app-created worktree the cleanup already removed, when it is the folder
 * the topic points at: the Overview then says so instead of reading git from a
 * folder that no longer exists (which would show its last, stale changes).
 */
export const findRemovedWorktree = (
  entries: OwnedWorktree[],
  workingDirectory: string | undefined,
): OwnedWorktree | undefined => {
  if (!workingDirectory) return;
  const target = normalizeDisplayPath(workingDirectory);
  return entries.find(
    (entry) => entry.cleanup?.state === 'removed' && normalizeDisplayPath(entry.path) === target,
  );
};

/**
 * The app-created worktrees the Overview offers a choice for: kept for their
 * uncommitted work, or left in place because the cleanup failed (the device
 * refused or git errored). Either way the folder is still there.
 */
export const findWorktreesAwaitingChoice = (entries: OwnedWorktree[]): OwnedWorktree[] =>
  entries.filter(
    (entry) => entry.cleanup?.state === 'keptDirty' || entry.cleanup?.state === 'failed',
  );

const WORKTREE_POLL_MS = 3000;
/** How long an archived topic's Overview waits for its cleanup to start. */
export const WORKTREE_DISCOVERY_MS = 60_000;

/**
 * How often the Overview re-reads the topic's worktrees: while a cleanup is in
 * flight, and — right after an archive — until the cleanup has started (it
 * runs after the archive response, so the first read can predate it). A
 * worktree that stays untouched past the window is held on purpose (in use, a
 * live run, a lock), and stops the polling.
 */
export const worktreeRefreshInterval = (
  entries: OwnedWorktree[] | undefined,
  { retired, sinceFirstReadMs }: { retired: boolean; sinceFirstReadMs: number },
): number => {
  if (!entries?.length) return 0;
  if (
    entries.some(
      (entry) => entry.cleanup?.state === 'pending' || entry.cleanup?.state === 'running',
    )
  )
    return WORKTREE_POLL_MS;
  if (
    retired &&
    sinceFirstReadMs < WORKTREE_DISCOVERY_MS &&
    entries.some((entry) => !entry.cleanup)
  )
    return WORKTREE_POLL_MS;
  return 0;
};
