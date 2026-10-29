import { isDesktop } from '@lobechat/const';
import type {
  DeviceGitAheadBehind,
  DeviceGitBranchListItem,
  DeviceGitPullRequestActivity,
  DeviceGitPullRequestDetail,
  DeviceGitPullRequestDetailResult,
  DeviceGitPullRequestMergeContext,
  DeviceGitRemoteBranchListItem,
  DeviceGitWorkingTreeStatus,
  DeviceGitWorktreeListItem,
} from '@lobechat/types';
import type { ReplicaOptimisticToken } from 'local-replica';
import type { ReplicaSlice, ReplicaSyncSchedule } from 'local-replica/zustand';
import { useCallback, useMemo, useRef } from 'react';

import { mutate } from '@/libs/swr';
import { deviceKeys, localFileKeys } from '@/libs/swr/keys';
import type { GitBranchSummary, GitLinkedPRSummary } from '@/services/git';

import {
  gitLinkedPRKey,
  gitPullRequestKey,
  gitPullRequestMergeContextKey,
  type GitPullRequestMergeContextParams,
  type GitPullRequestParams,
  gitReviewPatchesKey,
  type GitReviewRead,
  type ReviewMode,
  type ReviewPatchesData,
} from './gitReview/projection';
import { type GitReviewStore, useGitReviewStore, warmPullRequestReplicas } from './gitReview/store';
import {
  type GitDiffStats,
  gitStatusKey,
  type GitStatusParams,
  type GitStatusRead,
} from './gitStatus/projection';
import { type GitStatusStore, useGitStatusStore } from './gitStatus/store';

export type { ReviewMode, ReviewPatchesData } from './gitReview/projection';
export { getReviewSummaryState, toReviewPatchesSummary } from './gitReview/projection';

const UNSTAGED_REVIEW_REFRESH_INTERVAL = 10 * 1000;
const BRANCH_REVIEW_REFRESH_INTERVAL = 30 * 1000;
const PULL_REQUEST_DETAIL_REFRESH_INTERVAL = 30 * 1000;

/**
 * Git read hooks for a working directory, transport-agnostic: the fetcher goes
 * through `gitService`, which dispatches Electron IPC (local) vs `device.*` RPC
 * (remote, `deviceId` set). UI only consumes these hooks — same call shape for
 * local and remote. Disabled (no request) until a `path` is available, and on
 * web (no `isDesktop`) until a `deviceId` is too.
 */
const isEnabled = (deviceId: string | undefined, path: string | undefined): path is string =>
  !!path && (!!deviceId || isDesktop);

export const getReviewRefreshInterval = (mode: ReviewMode, active: boolean) => {
  if (!active) return 0;
  return mode === 'branch' ? BRANCH_REVIEW_REFRESH_INTERVAL : UNSTAGED_REVIEW_REFRESH_INTERVAL;
};

interface GitReviewCacheParams {
  baseRef?: string;
  deviceId?: string;
  dirPath?: string;
  mode: ReviewMode;
}

export const getGitReviewPatchesKey = ({
  baseRef,
  deviceId,
  dirPath,
  mode,
}: GitReviewCacheParams) =>
  dirPath ? deviceKeys.gitReviewPatches(deviceId ?? 'local', dirPath, mode, baseRef ?? '') : null;

export const invalidateGitReviewCaches = async ({
  baseRef,
  deviceId,
  dirPath,
  mode,
}: GitReviewCacheParams) => {
  if (!dirPath) return;

  const cacheDeviceId = deviceId ?? 'local';
  await Promise.all([
    // The review replica syncs under this key, so this re-runs its read.
    mutate(deviceKeys.gitReviewPatches(cacheDeviceId, dirPath, mode, baseRef ?? '')),
    useGitStatusStore
      .getState()
      .revalidateGitStatus(deviceId, dirPath, ['workingTreeStatus', 'aheadBehind']),
    mutate(localFileKeys.gitWorkingTreeFiles(deviceId, dirPath)),
  ]);
};

export interface GitReplicaReadResult<T> {
  data: T | undefined;
  error: unknown;
  /**
   * The device answered this session. A row hydrated from storage paints, but
   * is not proof enough to act on (e.g. mutate the PR it names).
   */
  isConfirmed: boolean;
  /** Nothing to paint yet (no persisted row, no response) and a read is pending. */
  isLoading: boolean;
  isValidating: boolean;
  /** Re-run the read (SWR-shaped, for the existing refresh callers). */
  mutate: () => Promise<unknown>;
}

type GitReplicaSyncOptions<TStored> = ReplicaSyncSchedule & {
  onHydrated?: (data: TStored) => void;
  onSuccess?: (data: TStored) => void;
};

interface ReplicaReadSlice<TParams, TStored> {
  useSync: (
    params: TParams | null | undefined,
    options?: GitReplicaSyncOptions<TStored> & { shouldRetryOnError?: boolean },
  ) => {
    error: unknown;
    isHydrated: boolean;
    isValidating: boolean;
    revalidate: () => Promise<unknown>;
  };
}

/**
 * Read one of the Review / PR replicas (see `./gitReview`): the persisted row
 * paints first, the device read confirms it in the background. Returns the
 * SWR-like shape the Review / PR tabs were written against.
 */
type ReplicaEntriesSelector = (
  state: GitReviewStore,
) => Record<string, { source?: string } | undefined>;

const useGitReviewReplica = <TParams, TStored>(
  pick: (slices: GitReviewStore['slices']) => ReplicaReadSlice<TParams, TStored>,
  selectMap: (state: GitReviewStore) => Record<string, TStored>,
  selectEntries: ReplicaEntriesSelector,
  toKey: (params: TParams) => string,
  params: TParams | null,
  schedule: GitReplicaSyncOptions<TStored>,
  /** Params to sync; `null` pauses syncing while `params` still reads the stored row. */
  syncParams: TParams | null = params,
) => {
  const key = params ? toKey(params) : undefined;
  const stored = useGitReviewStore((s) => (key ? selectMap(s)[key] : undefined));
  // Only a head response makes the row authoritative (`source: 'server'`).
  const isConfirmed = useGitReviewStore((s) => !!key && selectEntries(s)[key]?.source === 'server');
  // The driver forwards SWR options as given: a failed git read (dead path,
  // unreachable device, missing `gh`) is not retried, like the SWR hooks these replaced.
  const { error, isHydrated, isValidating, revalidate } = pick(
    useGitReviewStore.getState().slices,
  ).useSync(syncParams, { ...schedule, shouldRetryOnError: false });

  return {
    error,
    isConfirmed,
    isLoading: !!syncParams && stored === undefined && !error && (!isHydrated || isValidating),
    isValidating,
    mutate: revalidate,
    stored,
  };
};

/** A `GitReviewRead` replica, unwrapped into the SWR-shaped result. */
const useGitReviewRead = <TParams, T>(
  pick: (slices: GitReviewStore['slices']) => ReplicaReadSlice<TParams, GitReviewRead<T>>,
  selectMap: (state: GitReviewStore) => Record<string, GitReviewRead<T>>,
  selectEntries: ReplicaEntriesSelector,
  toKey: (params: TParams) => string,
  params: TParams | null,
  schedule: GitReplicaSyncOptions<GitReviewRead<T>>,
): GitReplicaReadResult<T> => {
  const { stored, ...rest } = useGitReviewReplica(
    pick,
    selectMap,
    selectEntries,
    toKey,
    params,
    schedule,
  );
  return { ...rest, data: stored?.value };
};

/**
 * Review tab diff. A replica: after a reload the persisted summary (paths +
 * line counts, `summaryOnly`, no diff text) paints first, and the live read
 * replaces it with the full diff.
 */
export const useReviewPatches = (
  dirPath: string | undefined,
  mode: ReviewMode,
  baseRef?: string,
  deviceId?: string,
  active = true,
): GitReplicaReadResult<ReviewPatchesData> => {
  const enabled = isEnabled(deviceId, dirPath);
  const params = useMemo(
    () => (enabled ? { baseRef, deviceId, mode, path: dirPath! } : null),
    [enabled, baseRef, deviceId, mode, dirPath],
  );
  const { stored, ...rest } = useGitReviewReplica(
    (slices) => slices.reviewPatches,
    (s) => s.gitReviewPatchesMap,
    (s) => s.gitReviewPatchesReplica.entries,
    gitReviewPatchesKey,
    params,
    {
      focusThrottleInterval: mode === 'branch' ? 30 * 1000 : 5 * 1000,
      refreshInterval: getReviewRefreshInterval(mode, active),
      refreshWhenHidden: false,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    },
    // Inactive callers (a collapsed Review panel) keep the last diff instead of
    // dropping to undefined, so reopening does not re-render every file from empty.
    active ? params : null,
  );
  return { ...rest, data: stored };
};

interface GitStatusReadResult<T> {
  data: T | undefined;
  error: unknown;
  /**
   * The current probe answered. A row hydrated from storage (or an optimistic
   * write) is good enough to paint, but not to act on: the device read is the
   * only thing that proves the persisted branch still exists.
   */
  isConfirmed: boolean;
  /** Nothing to paint yet (no persisted row, no response) and a read is pending. */
  isLoading: boolean;
  isValidating: boolean;
  /**
   * SWR-shaped: no argument re-runs the read; a value starts an optimistic
   * overlay (memory only, never persisted) and, unless `revalidate: false`,
   * re-runs the read that settles it.
   */
  mutate: (data?: T, options?: { revalidate?: boolean }) => Promise<unknown>;
  /** Confirmed local write (persisted): for derived data a sibling read owns. */
  set: (data: T) => void;
}

type GitStatusSlice<T> = Pick<
  ReplicaSlice<GitStatusStore, GitStatusParams, GitStatusRead<T>, any>,
  'beginOptimistic' | 'fetch' | 'revalidate' | 'update' | 'useSync'
>;

/**
 * Read one of the replica-backed git status reads (see `./gitStatus`): the
 * persisted row paints first, the device read confirms it in the background.
 * Returns the SWR-like shape the git chips were written against.
 */
const useGitStatusRead = <T>(
  slice: GitStatusSlice<T>,
  selectMap: (state: GitStatusStore) => Record<string, GitStatusRead<T>>,
  selectEntries: (state: GitStatusStore) => Record<string, { source?: string } | undefined>,
  deviceId: string | undefined,
  path: string | undefined,
  schedule: ReplicaSyncSchedule,
  enabled = true,
): GitStatusReadResult<T> => {
  const params = useMemo(
    () => (enabled && isEnabled(deviceId, path) ? { deviceId, path } : null),
    [enabled, deviceId, path],
  );
  const key = params ? gitStatusKey(params) : undefined;
  const stored = useGitStatusStore((s) => (key ? selectMap(s)[key] : undefined));
  // Only a head response makes the row authoritative (`source: 'server'`); a
  // hydrated or optimistic row is a paint-only stand-in. Consumers use this to
  // gate checkout / pull / push and the dead-directory hand-off.
  const isConfirmed = useGitStatusStore((s) => !!key && selectEntries(s)[key]?.source === 'server');
  // The driver forwards SWR options as given: a failed git read (dead path,
  // unreachable device) is not retried, like the SWR hooks these replaced.
  const syncOptions = { ...schedule, shouldRetryOnError: false };
  const { error, isHydrated, isValidating, revalidate } = slice.useSync(params, syncOptions);

  /**
   * An optimistic write whose probe has not settled yet. Overlays are rebased
   * onto every server response and are never persisted, so a read that started
   * before the checkout cannot repaint the previous branch.
   */
  const optimistic = useRef<{
    key: string;
    token: ReplicaOptimisticToken<GitStatusRead<T>>;
  } | null>(null);

  const mutate = useCallback(
    async (data?: T, options?: { revalidate?: boolean }) => {
      if (!key) return;
      if (data !== undefined) {
        // The checkout can fail, or the app can close before `onAfterCheckout`
        // revalidates: keep the value in an overlay so the next launch paints
        // the confirmed branch, not one that never landed.
        optimistic.current = {
          key,
          token: slice.beginOptimistic(key, (current) => ({ ...current, value: data })),
        };
      }
      if (data === undefined || options?.revalidate !== false) {
        const pending = optimistic.current;
        if (pending && params) {
          // A fresh read, not `revalidate`: a pre-checkout request may still be
          // in flight, and its response would settle the overlay back to the
          // branch the user just left.
          try {
            await slice.fetch(params, { fresh: true });
          } catch {
            // Keep the confirmed base; a later read repairs an unreachable device.
          } finally {
            // The head response already persisted the confirmed value. Roll back
            // to it: committing would re-apply the optimistic mutation to the
            // base, so a FAILED checkout would be re-persisted as if it landed.
            if (optimistic.current === pending) {
              pending.token.rollback();
              optimistic.current = null;
            }
          }
          return;
        }
        await revalidate();
      }
    },
    [key, slice, revalidate],
  );

  const set = useCallback(
    (data: T) => {
      if (!key) return;
      // Confirmed by the read that produced it (the review patches), so it is
      // allowed to replace and persist the row.
      slice.update(key, () => ({ value: data }));
    },
    [key, slice],
  );

  return {
    data: stored?.value,
    error,
    isConfirmed,
    isLoading: !!params && stored === undefined && !error && (!isHydrated || isValidating),
    isValidating,
    mutate,
    set,
  };
};

const selectBranchMap = (s: GitStatusStore) => s.gitBranchMap;
const selectBranchListMap = (s: GitStatusStore) => s.gitBranchListMap;
const selectRemoteBranchListMap = (s: GitStatusStore) => s.gitRemoteBranchListMap;
const selectAheadBehindMap = (s: GitStatusStore) => s.gitAheadBehindMap;
const selectWorkingTreeStatusMap = (s: GitStatusStore) => s.gitWorkingTreeStatusMap;
const selectWorktreesMap = (s: GitStatusStore) => s.gitWorktreesMap;

const selectDiffStatsMap = (s: GitStatusStore) => s.gitDiffStatsMap;

const selectBranchEntries = (s: GitStatusStore) => s.gitBranchReplica.entries;
const selectBranchListEntries = (s: GitStatusStore) => s.gitBranchListReplica.entries;
const selectRemoteBranchListEntries = (s: GitStatusStore) => s.gitRemoteBranchListReplica.entries;
const selectAheadBehindEntries = (s: GitStatusStore) => s.gitAheadBehindReplica.entries;
const selectDiffStatsEntries = (s: GitStatusStore) => s.gitDiffStatsReplica.entries;
const selectWorkingTreeStatusEntries = (s: GitStatusStore) => s.gitWorkingTreeStatusReplica.entries;
const selectWorktreesEntries = (s: GitStatusStore) => s.gitWorktreesReplica.entries;

/**
 * Current branch + detached state. A cheap local git read, so use a short
 * dedupe window (2s): switching the working directory must refetch the branch
 * promptly. A longer window would swallow the key-change revalidation and
 * leave the branch label stuck on the previous directory (only a manual
 * `mutate()` refresh would recover it). 2s still collapses truly concurrent
 * reads of the same dir.
 */
export const useFetchGitBranch = (deviceId: string | undefined, path?: string) =>
  useGitStatusRead<GitBranchSummary>(
    useGitStatusStore.getState().slices.branch,
    selectBranchMap,
    selectBranchEntries,
    deviceId,
    path,
    { dedupingInterval: 2 * 1000 },
  );

/**
 * PR linked to the current branch. The lookup spawns `gh pr list` (8s timeout),
 * so keep a long 60s dedupe + 60s focus throttle — unlike the cheap branch read,
 * this must NOT re-run on every remount or directory revisit. Keyed by branch,
 * so a checkout naturally re-keys into a fresh lookup; disabled for non-github
 * repos and detached HEAD (no branch ref to query). Includes merged/closed PRs
 * so the lifecycle badge can refresh after GitHub changes outside the app.
 */
export const useFetchGitLinkedPR = (
  deviceId: string | undefined,
  path: string | undefined,
  branch: string | undefined,
  isGithub = false,
) => {
  const enabled = isGithub && !!branch && isEnabled(deviceId, path);
  const params = useMemo(
    () => (enabled ? { branch: branch!, deviceId, path: path! } : null),
    [enabled, branch, deviceId, path],
  );
  // The PR tab mounts the moment the linked PR is known; start reading its
  // persisted detail / activity then, so the tab body paints from storage on
  // its first frame instead of a skeleton while its own hydration reads them.
  const warm = useCallback(
    (read: GitReviewRead<GitLinkedPRSummary>) => {
      const number = read.value?.pullRequest?.number;
      if (number !== undefined && path) warmPullRequestReplicas({ deviceId, number, path });
    },
    [deviceId, path],
  );
  return useGitReviewRead(
    (slices) => slices.linkedPR,
    (s) => s.gitLinkedPRMap,
    (s) => s.gitLinkedPRReplica.entries,
    gitLinkedPRKey,
    params,
    {
      dedupingInterval: 60 * 1000,
      focusThrottleInterval: 60 * 1000,
      onHydrated: warm,
      onSuccess: warm,
    },
  );
};

/**
 * Compact uncommitted-diff counts for the composer's `+N −M` chip. There is no
 * read of its own: the review-patch hook writes the counts here once they load,
 * so a reload paints the previous session's chip before the diff is fetched.
 */
export const useFetchGitDiffStats = (deviceId: string | undefined, path?: string) =>
  useGitStatusRead<GitDiffStats>(
    useGitStatusStore.getState().slices.diffStats,
    selectDiffStatsMap,
    selectDiffStatsEntries,
    deviceId,
    path,
    {},
  );

/**
 * Working-tree dirty-file counts. Revalidates on focus (5s throttle) so the
 * +N ~M -K badge tracks edits when the user switches back to the window.
 */
export const useFetchGitWorkingTreeStatus = (deviceId: string | undefined, path?: string) =>
  useGitStatusRead<DeviceGitWorkingTreeStatus>(
    useGitStatusStore.getState().slices.workingTreeStatus,
    selectWorkingTreeStatusMap,
    selectWorkingTreeStatusEntries,
    deviceId,
    path,
    { focusThrottleInterval: 5 * 1000, revalidateOnFocus: true },
  );

/**
 * Ahead/behind commit counts. Each load piggybacks a best-effort `git fetch`
 * inside the read, so focus revalidation (5s throttle) surfaces remote updates.
 */
export const useFetchGitAheadBehind = (deviceId: string | undefined, path?: string) =>
  useGitStatusRead<DeviceGitAheadBehind>(
    useGitStatusStore.getState().slices.aheadBehind,
    selectAheadBehindMap,
    selectAheadBehindEntries,
    deviceId,
    path,
    { focusThrottleInterval: 5 * 1000, revalidateOnFocus: true },
  );

/**
 * Worktrees attached to the same repository as the current working directory.
 * Revalidates on focus so temp PR worktrees created outside the app appear
 * without restarting the conversation.
 */
export const useFetchGitWorktrees = (deviceId: string | undefined, path?: string) =>
  useGitStatusRead<DeviceGitWorktreeListItem[]>(
    useGitStatusStore.getState().slices.worktrees,
    selectWorktreesMap,
    selectWorktreesEntries,
    deviceId,
    path,
    { focusThrottleInterval: 5 * 1000, revalidateOnFocus: true },
  );

export const pullRequestDetailRefreshInterval = (
  detail: DeviceGitPullRequestDetailResult | undefined,
  active: boolean,
): number => {
  if (!active || !detail?.detail || detail.detail.state !== 'open') return 0;
  const isPending =
    !!detail.detail.autoMerge ||
    detail.detail.reviewDecision === 'REVIEW_REQUIRED' ||
    detail.detail.reviewDecision === 'CHANGES_REQUESTED' ||
    detail.detail.mergeStateStatus === 'BLOCKED' ||
    detail.detail.mergeable === 'UNKNOWN' ||
    detail.detail.checks.some((c) => c.status === 'pending');
  return isPending ? PULL_REQUEST_DETAIL_REFRESH_INTERVAL : 0;
};

/**
 * Full pull request detail for the Working Sidebar's Pull Request tab. Polls
 * every 30s while checks, reviews, auto-merge, or mergeability haven't resolved
 * yet, and stops once the PR settles into a steady state.
 */
export const useFetchGitPullRequestDetail = (
  deviceId: string | undefined,
  path: string | undefined,
  number: number | undefined,
  { active = true }: { active?: boolean } = {},
) => {
  const enabled = number !== undefined && isEnabled(deviceId, path);
  const params = useMemo(
    () => (enabled ? { deviceId, number: number!, path: path! } : null),
    [enabled, deviceId, number, path],
  );
  return useGitReviewRead(
    (slices) => slices.pullRequestDetail,
    (s) => s.gitPullRequestDetailMap,
    (s) => s.gitPullRequestDetailReplica.entries,
    gitPullRequestKey,
    params,
    {
      dedupingInterval: 30_000,
      focusThrottleInterval: 60 * 1000,
      refreshInterval: (latest?: GitReviewRead<DeviceGitPullRequestDetailResult>) =>
        pullRequestDetailRefreshInterval(latest?.value, active),
      revalidateOnFocus: true,
    },
  );
};

/** Activity starts once core data can paint; its failure never hides the PR. */
export const useFetchGitPullRequestActivity = (
  deviceId: string | undefined,
  path: string | undefined,
  number: number | undefined,
  active = true,
) => {
  const enabled = number !== undefined && isEnabled(deviceId, path);
  const params = useMemo(
    () => (enabled ? { deviceId, number: number!, path: path! } : null),
    [enabled, deviceId, number, path],
  );
  return useGitReviewRead<GitPullRequestParams, DeviceGitPullRequestActivity>(
    (slices) => slices.pullRequestActivity,
    (s) => s.gitPullRequestActivityMap,
    (s) => s.gitPullRequestActivityReplica.entries,
    gitPullRequestKey,
    params,
    {
      dedupingInterval: 30_000,
      focusThrottleInterval: 60_000,
      refreshInterval: active ? 30_000 : 0,
    },
  );
};

/**
 * Slow merge context (permission, branch protection, base drift), keyed on the
 * PR head so a push refetches it. Runs after the detail so the pane paints first.
 */
export const useFetchGitPullRequestMergeContext = (
  deviceId: string | undefined,
  path: string | undefined,
  detail:
    Pick<DeviceGitPullRequestDetail, 'baseRefName' | 'headRefOid' | 'number' | 'repo'> | undefined,
) => {
  const enabled = !!detail && isEnabled(deviceId, path);
  const { baseRefName, headRefOid, number } = detail ?? {};
  const repoName = detail?.repo.name;
  const repoOwner = detail?.repo.owner;
  const params = useMemo(
    () =>
      enabled
        ? {
            baseRefName: baseRefName!,
            deviceId,
            headRefOid: headRefOid!,
            number: number!,
            path: path!,
            repo: { name: repoName!, owner: repoOwner! },
          }
        : null,
    [enabled, baseRefName, deviceId, headRefOid, number, path, repoName, repoOwner],
  );
  return useGitReviewRead<
    GitPullRequestMergeContextParams,
    DeviceGitPullRequestMergeContext | null
  >(
    (slices) => slices.pullRequestMergeContext,
    (s) => s.gitPullRequestMergeContextMap,
    (s) => s.gitPullRequestMergeContextReplica.entries,
    gitPullRequestMergeContextKey,
    params,
    { dedupingInterval: 30_000, focusThrottleInterval: 60 * 1000, revalidateOnFocus: true },
  );
};

/**
 * Local branches of a directory: the branch switcher's list and the names a new
 * worktree branch must avoid. The persisted list paints the switcher the moment
 * it opens; `isConfirmed` says whether this session's read has answered (a name
 * drawn against a stale list could collide with a branch made since). The 10s
 * dedupe lets the switcher and the worktree seed share one read; branch writes
 * re-read through `refreshGitBranches`.
 */
export const useFetchGitBranches = (
  deviceId: string | undefined,
  path: string | undefined,
  enabled = true,
) =>
  useGitStatusRead<DeviceGitBranchListItem[]>(
    useGitStatusStore.getState().slices.branches,
    selectBranchListMap,
    selectBranchListEntries,
    deviceId,
    path,
    { dedupingInterval: 10 * 1000, revalidateOnFocus: false },
    enabled,
  );

/**
 * Remote branches under `refs/remotes/origin/*`, read once a base-ref picker
 * opens. The persisted list paints the picker immediately; the read refreshes it.
 */
export const useGitRemoteBranches = (
  dirPath: string | undefined,
  enabled: boolean,
  deviceId?: string,
) =>
  useGitStatusRead<DeviceGitRemoteBranchListItem[]>(
    useGitStatusStore.getState().slices.remoteBranches,
    selectRemoteBranchListMap,
    selectRemoteBranchListEntries,
    deviceId,
    dirPath,
    { dedupingInterval: 10 * 1000, revalidateOnFocus: false },
    enabled,
  );
