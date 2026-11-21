import type {
  DeviceGitPullRequestActivity,
  DeviceGitPullRequestDetailResult,
  DeviceGitPullRequestMergeContext,
} from '@lobechat/types';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import {
  createReplicaSlice,
  createReplicaState,
  recordLens,
  type ReplicaState,
} from '@/libs/replica';
import { type GitLinkedPRSummary, gitService } from '@/services/git';
import { createDevtools } from '@/store/middleware/createDevtools';
import { expose } from '@/store/middleware/expose';

import {
  boundedPersist,
  type GitLinkedPRParams,
  gitLinkedPRResource,
  gitPullRequestActivityResource,
  gitPullRequestDetailResource,
  gitPullRequestKey,
  type GitPullRequestMergeContextParams,
  gitPullRequestMergeContextResource,
  type GitPullRequestParams,
  type GitReviewPatchesParams,
  gitReviewPatchesResource,
  type GitReviewRead,
  type ReviewPatchesData,
  toReviewPatchesSummary,
} from './projection';

type LinkedPRRead = GitReviewRead<GitLinkedPRSummary>;
type DetailRead = GitReviewRead<DeviceGitPullRequestDetailResult>;
type ActivityRead = GitReviewRead<DeviceGitPullRequestActivity>;
type MergeContextRead = GitReviewRead<DeviceGitPullRequestMergeContext | null>;

export interface GitReviewStoreState {
  /** `gitLinkedPRKey(params)` → PR linked to a branch. */
  gitLinkedPRMap: Record<string, LinkedPRRead>;
  gitLinkedPRReplica: ReplicaState<LinkedPRRead>;
  /** `gitPullRequestKey(params)` → comments / reviews / commits. */
  gitPullRequestActivityMap: Record<string, ActivityRead>;
  gitPullRequestActivityReplica: ReplicaState<ActivityRead>;
  /** `gitPullRequestKey(params)` → PR core detail. */
  gitPullRequestDetailMap: Record<string, DetailRead>;
  gitPullRequestDetailReplica: ReplicaState<DetailRead>;
  /** `gitPullRequestMergeContextKey(params)` → permission / protection / base drift. */
  gitPullRequestMergeContextMap: Record<string, MergeContextRead>;
  gitPullRequestMergeContextReplica: ReplicaState<MergeContextRead>;
  /** `gitReviewPatchesKey(params)` → review diff (a diff-free summary after a reload). */
  gitReviewPatchesMap: Record<string, ReviewPatchesData>;
  gitReviewPatchesReplica: ReplicaState<ReviewPatchesData>;
}

export const initialGitReviewState: GitReviewStoreState = {
  gitLinkedPRMap: {},
  gitLinkedPRReplica: createReplicaState(),
  gitPullRequestActivityMap: {},
  gitPullRequestActivityReplica: createReplicaState(),
  gitPullRequestDetailMap: {},
  gitPullRequestDetailReplica: createReplicaState(),
  gitPullRequestMergeContextMap: {},
  gitPullRequestMergeContextReplica: createReplicaState(),
  gitReviewPatchesMap: {},
  gitReviewPatchesReplica: createReplicaState(),
};

/**
 * A remote device read resolves to `undefined` when the gateway or the device
 * RPC fails (the local IPC always answers). That is an unknown result, not an
 * empty one: reject it so the replica keeps the persisted copy instead of
 * committing — and persisting — "no changes" / "no PR" over it.
 */
const requireAnswer = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`Unable to load ${what}`);
  return value;
};

const fetchReviewPatches = async ({
  baseRef,
  deviceId,
  mode,
  path,
}: GitReviewPatchesParams): Promise<ReviewPatchesData> => {
  if (mode === 'unstaged') {
    const result = requireAnswer(
      await gitService.getGitWorkingTreePatches({ deviceId, path }),
      'working tree changes',
    );
    return { mode: 'unstaged', patches: result.patches ?? [], submodules: result.submodules };
  }
  const result = requireAnswer(
    await gitService.getGitBranchDiff({ baseRef, deviceId, path }),
    'branch diff',
  );
  return {
    baseRef: result.baseRef,
    headRef: result.headRef,
    mode: 'branch',
    patches: result.patches ?? [],
    submodules: result.submodules,
  };
};

const createSlices = (
  set: (partial: Partial<GitReviewStore>, replace?: false, action?: any) => void,
  get: () => GitReviewStore,
) => ({
  linkedPR: createReplicaSlice(gitLinkedPRResource, {
    actionPrefix: 'gitReview/linkedPR',
    // "No PR" is an answer (`pullRequest: null`, status `ok`); `undefined` (a
    // failed remote read) and status `error` (a transient `gh` failure) are not.
    // `gh-missing` stays an answer: the composer shows it.
    fetcher: async (params: GitLinkedPRParams) => {
      const value = requireAnswer(
        await gitService.getLinkedPullRequest(params),
        'linked pull request',
      );
      if (value.pullRequestStatus === 'error')
        throw new Error('Unable to load linked pull request');
      return { value };
    },
    get,
    set,
    stateKey: 'gitLinkedPRReplica',
    view: recordLens<GitReviewStore, LinkedPRRead>('gitLinkedPRMap'),
  }),
  pullRequestActivity: createReplicaSlice(gitPullRequestActivityResource, {
    actionPrefix: 'gitReview/pullRequestActivity',
    fetcher: async (params: GitPullRequestParams) => ({
      value: await gitService.getPullRequestActivity(params),
    }),
    get,
    set,
    stateKey: 'gitPullRequestActivityReplica',
    // Comment bodies are unbounded.
    toPersisted: boundedPersist,
    view: recordLens<GitReviewStore, ActivityRead>('gitPullRequestActivityMap'),
  }),
  pullRequestDetail: createReplicaSlice(gitPullRequestDetailResource, {
    actionPrefix: 'gitReview/pullRequestDetail',
    fetcher: async (params: GitPullRequestParams) => {
      const value = await gitService.getPullRequestDetail({ ...params, coreOnly: true });
      // A failed lookup (including a remote read the service maps to
      // `status: 'error'`) must not replace the persisted PR.
      if (value.status === 'error') throw new Error('Unable to load pull request');
      return { value };
    },
    get,
    set,
    stateKey: 'gitPullRequestDetailReplica',
    // The PR description is unbounded.
    toPersisted: boundedPersist,
    view: recordLens<GitReviewStore, DetailRead>('gitPullRequestDetailMap'),
  }),
  pullRequestMergeContext: createReplicaSlice(gitPullRequestMergeContextResource, {
    actionPrefix: 'gitReview/pullRequestMergeContext',
    // The local read always answers; `null` is the service's mapping of a
    // failed remote read and must not replace the persisted context.
    fetcher: async (params: GitPullRequestMergeContextParams) => {
      const value = await gitService.getPullRequestMergeContext(params);
      if (value === null) throw new Error('Unable to load pull request merge context');
      return { value };
    },
    get,
    set,
    stateKey: 'gitPullRequestMergeContextReplica',
    view: recordLens<GitReviewStore, MergeContextRead>('gitPullRequestMergeContextMap'),
  }),
  reviewPatches: createReplicaSlice(gitReviewPatchesResource, {
    actionPrefix: 'gitReview/reviewPatches',
    fetcher: fetchReviewPatches,
    get,
    set,
    stateKey: 'gitReviewPatchesReplica',
    // Diff text can run to megabytes and is cheap to re-read: persist only the
    // file list + counts, and nothing when even that is outsized.
    toPersisted: (data) => boundedPersist(toReviewPatchesSummary(data)),
    view: recordLens<GitReviewStore, ReviewPatchesData>('gitReviewPatchesMap'),
  }),
});

type GitReviewSlices = ReturnType<typeof createSlices>;

export interface GitReviewStore extends GitReviewStoreState {
  /** @internal The replica slices; read through the hooks in `gitHooks.ts`. */
  slices: GitReviewSlices;
}

const devtools = createDevtools('gitReview');

export const useGitReviewStore = createWithEqualityFn<GitReviewStore>()(
  devtools((set, get) => ({
    ...initialGitReviewState,
    slices: createSlices(set, get),
  })),
  shallow,
);

expose('gitReview', useGitReviewStore);

/**
 * Read a PR's persisted detail and activity into memory ahead of the PR tab's
 * own hydration. Rows already in memory are left alone.
 */
export const warmPullRequestReplicas = (params: GitPullRequestParams) => {
  const { gitPullRequestActivityMap, gitPullRequestDetailMap, slices } =
    useGitReviewStore.getState();
  const key = gitPullRequestKey(params);
  if (!gitPullRequestDetailMap[key]) void slices.pullRequestDetail.hydrate(params);
  if (!gitPullRequestActivityMap[key]) void slices.pullRequestActivity.hydrate(params);
};
