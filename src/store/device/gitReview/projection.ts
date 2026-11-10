import type {
  GitWorkingTreePatch,
  SubmoduleWorkingTreePatches,
} from '@lobechat/electron-client-ipc';
import type {
  DeviceGitPullRequestActivity,
  DeviceGitPullRequestDetailResult,
  DeviceGitPullRequestMergeContext,
} from '@lobechat/types';

import { defineReplica } from '@/libs/replica';
import { deviceKeys } from '@/libs/swr/keys';
import type { GitLinkedPRSummary } from '@/services/git';

/**
 * The Working Sidebar Review and Pull Request tab reads. They are replicas so
 * a reload paints the last file list / PR on the first frame and the device
 * read only confirms it.
 *
 * Rows are partitioned by the cache scope (user + workspace) and keyed by
 * device + directory (+ mode / base / branch / PR number), so two devices that
 * share a path never paint each other's state. None of these payloads carry
 * credentials. Each resource adopts the SWR key the app already revalidates
 * by (`syncKey`), so `invalidateGitReviewCaches` and the PR actions' `mutate`
 * calls keep refreshing them.
 */

export type ReviewMode = 'unstaged' | 'branch';

export interface ReviewPatchesData {
  baseRef?: string;
  headRef?: string;
  mode: ReviewMode;
  patches: GitWorkingTreePatch[];
  /**
   * Per-submodule patch groups. Undefined when the parent has no dirty
   * submodules (unstaged) or no submodule pointer differences (branch).
   */
  submodules?: SubmoduleWorkingTreePatches[];
  /**
   * Set on the persisted summary (see `toReviewPatchesSummary`): paths and
   * line counts are real, but every `patch` body is empty until the live read
   * lands.
   */
  summaryOnly?: boolean;
}

/** `local` stands for this machine, like the SWR device keys. */
const LOCAL = 'local';
const joinKey = (...parts: (string | number)[]) => parts.join('\u0000');

/**
 * One answered read. The value is wrapped so a read that answered with nothing
 * (no linked PR, unreachable device: `value` absent) still replaces a stale
 * persisted row — a bare `undefined` / `null` response would leave it in place.
 */
export interface GitReviewRead<T> {
  value?: T;
}

/** Serialized-JSON ceiling of one persisted row; larger values stay memory-only. */
export const GIT_REVIEW_MAX_PERSISTED_BYTES = 512 * 1024;

const fitsPersistCeiling = (value: unknown) => {
  try {
    return (JSON.stringify(value)?.length ?? 0) <= GIT_REVIEW_MAX_PERSISTED_BYTES;
  } catch {
    return false;
  }
};

/**
 * Persist a value only when it fits the ceiling. An outsized value returns
 * `null`, which also drops the older (smaller) row, so a reload never paints a
 * value the live read has moved past.
 */
export const boundedPersist = <T>(data: T): T | null => (fitsPersistCeiling(data) ? data : null);

const summarizePatch = ({
  additions,
  deletions,
  filePath,
  isBinary,
  status,
  truncated,
}: GitWorkingTreePatch): GitWorkingTreePatch => ({
  additions,
  deletions,
  filePath,
  isBinary,
  patch: '',
  status,
  truncated,
});

/**
 * The persistable shape of a review read: file paths, statuses and +/- counts
 * without diff text, which can run to megabytes and is cheap to re-read.
 */
export const toReviewPatchesSummary = (data: ReviewPatchesData): ReviewPatchesData => ({
  baseRef: data.baseRef,
  headRef: data.headRef,
  mode: data.mode,
  patches: data.patches.map(summarizePatch),
  submodules: data.submodules?.map((sub) => ({ ...sub, patches: sub.patches.map(summarizePatch) })),
  summaryOnly: true,
});

/**
 * How the Review tab treats a painted read. A persisted summary is unconfirmed:
 * the path may now hold different content, so destructive per-file actions
 * (revert) wait for the live read (`isSummary`). Its expanded rows show a
 * placeholder only while that read can still land (`diffPending`): a failed
 * read leaves the summary in place, and the rows must then report the missing
 * diff instead of loading forever.
 */
export const getReviewSummaryState = (data: ReviewPatchesData | undefined, error: unknown) => {
  const isSummary = !!data?.summaryOnly;
  return { diffPending: isSummary && !error, isSummary };
};

export interface GitReviewPatchesParams {
  baseRef?: string;
  /** Remote device; `undefined` reads this machine over Electron IPC. */
  deviceId?: string;
  mode: ReviewMode;
  path: string;
}

export interface GitLinkedPRParams {
  branch: string;
  deviceId?: string;
  path: string;
  /**
   * The PR a topic recorded for this branch, so the lookup follows that PR even
   * after another one opens on the branch. Absent for the composer's lookup.
   */
  pullRequestNumber?: number;
}

export interface GitPullRequestParams {
  deviceId?: string;
  number: number;
  path: string;
}

export interface GitPullRequestMergeContextParams extends GitPullRequestParams {
  baseRefName: string;
  headRefOid: string;
  repo: { name: string; owner: string };
}

export const gitReviewPatchesKey = ({ baseRef, deviceId, mode, path }: GitReviewPatchesParams) =>
  joinKey(deviceId ?? LOCAL, path, mode, baseRef ?? '');

/** Without a PR number this is the composer's key, so both readers share one row. */
export const gitLinkedPRKey = ({ branch, deviceId, path, pullRequestNumber }: GitLinkedPRParams) =>
  pullRequestNumber === undefined
    ? joinKey(deviceId ?? LOCAL, path, branch)
    : joinKey(deviceId ?? LOCAL, path, branch, pullRequestNumber);

export const gitPullRequestKey = ({ deviceId, number, path }: GitPullRequestParams) =>
  joinKey(deviceId ?? LOCAL, path, number);

export const gitPullRequestMergeContextKey = ({
  baseRefName,
  deviceId,
  headRefOid,
  number,
  path,
}: GitPullRequestMergeContextParams) =>
  joinKey(deviceId ?? LOCAL, path, number, headRefOid, baseRefName);

/** Repositories / PRs a user works on; old ones fall out of storage, not out of the app. */
const persist = { maxEntries: 30 };

/**
 * Review tab diff. The store keeps the full diff; storage keeps only the
 * path + line-count summary (`toReviewPatchesSummary`, applied by the slice).
 */
export const gitReviewPatchesResource = defineReplica<GitReviewPatchesParams, ReviewPatchesData>({
  key: gitReviewPatchesKey,
  name: 'deviceGitReviewPatches',
  persist,
  storage: 'indexedDB',
  syncKey: ({ baseRef, deviceId, mode, path }) =>
    deviceKeys.gitReviewPatches(deviceId ?? LOCAL, path, mode, baseRef ?? ''),
  version: 1,
});

export const gitLinkedPRResource = defineReplica<
  GitLinkedPRParams,
  GitReviewRead<GitLinkedPRSummary>
>({
  key: gitLinkedPRKey,
  name: 'deviceGitLinkedPR',
  persist: { maxEntries: 50 },
  storage: 'indexedDB',
  syncKey: ({ branch, deviceId, path, pullRequestNumber }) =>
    deviceKeys.gitLinkedPR(deviceId ?? LOCAL, path, branch, pullRequestNumber),
  version: 1,
});

export const gitPullRequestDetailResource = defineReplica<
  GitPullRequestParams,
  GitReviewRead<DeviceGitPullRequestDetailResult>
>({
  key: gitPullRequestKey,
  name: 'deviceGitPullRequestDetail',
  persist,
  storage: 'indexedDB',
  syncKey: ({ deviceId, number, path }) =>
    deviceKeys.gitPullRequestDetail(deviceId ?? LOCAL, path, number),
  version: 1,
});

export const gitPullRequestActivityResource = defineReplica<
  GitPullRequestParams,
  GitReviewRead<DeviceGitPullRequestActivity>
>({
  key: gitPullRequestKey,
  name: 'deviceGitPullRequestActivity',
  persist,
  storage: 'indexedDB',
  syncKey: ({ deviceId, number, path }) =>
    deviceKeys.gitPullRequestActivity(deviceId ?? LOCAL, path, number),
  version: 1,
});

export const gitPullRequestMergeContextResource = defineReplica<
  GitPullRequestMergeContextParams,
  GitReviewRead<DeviceGitPullRequestMergeContext | null>
>({
  key: gitPullRequestMergeContextKey,
  name: 'deviceGitPullRequestMergeContext',
  persist,
  storage: 'indexedDB',
  syncKey: ({ baseRefName, deviceId, headRefOid, number, path }) =>
    deviceKeys.gitPullRequestMergeContext(deviceId ?? LOCAL, path, number, headRefOid, baseRefName),
  version: 1,
});
