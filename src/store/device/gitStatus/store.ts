import type {
  DeviceGitAheadBehind,
  DeviceGitBranchListItem,
  DeviceGitRemoteBranchListItem,
  DeviceGitWorkingTreeStatus,
  DeviceGitWorktreeListItem,
} from '@lobechat/types';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import {
  createReplicaSlice,
  createReplicaState,
  recordLens,
  type ReplicaState,
} from '@/libs/replica';
import { type GitBranchSummary, gitService } from '@/services/git';
import { createDevtools } from '@/store/middleware/createDevtools';
import { expose } from '@/store/middleware/expose';

import {
  gitAheadBehindResource,
  gitBranchListResource,
  gitBranchResource,
  type GitDiffStats,
  gitDiffStatsResource,
  gitRemoteBranchListResource,
  gitStatusKey,
  type GitStatusParams,
  type GitStatusRead,
  gitWorkingTreeStatusResource,
  gitWorktreesResource,
} from './projection';

export interface GitStatusStoreState {
  /** `gitStatusKey(params)` → ahead/behind counts. */
  gitAheadBehindMap: Record<string, GitStatusRead<DeviceGitAheadBehind>>;
  gitAheadBehindReplica: ReplicaState<GitStatusRead<DeviceGitAheadBehind>>;
  /** `gitStatusKey(params)` → local branches (switcher list, worktree name seed). */
  gitBranchListMap: Record<string, GitStatusRead<DeviceGitBranchListItem[]>>;
  gitBranchListReplica: ReplicaState<GitStatusRead<DeviceGitBranchListItem[]>>;
  /** `gitStatusKey(params)` → current branch + detached + upstream. */
  gitBranchMap: Record<string, GitStatusRead<GitBranchSummary>>;
  gitBranchReplica: ReplicaState<GitStatusRead<GitBranchSummary>>;
  /** `gitStatusKey(params)` → uncommitted diff line/file counts (composer chip). */
  gitDiffStatsMap: Record<string, GitStatusRead<GitDiffStats>>;
  gitDiffStatsReplica: ReplicaState<GitStatusRead<GitDiffStats>>;
  /** `gitStatusKey(params)` → `origin/*` branches (base-ref pickers). */
  gitRemoteBranchListMap: Record<string, GitStatusRead<DeviceGitRemoteBranchListItem[]>>;
  gitRemoteBranchListReplica: ReplicaState<GitStatusRead<DeviceGitRemoteBranchListItem[]>>;
  /** `gitStatusKey(params)` → dirty-file counts. */
  gitWorkingTreeStatusMap: Record<string, GitStatusRead<DeviceGitWorkingTreeStatus>>;
  gitWorkingTreeStatusReplica: ReplicaState<GitStatusRead<DeviceGitWorkingTreeStatus>>;
  /** `gitStatusKey(params)` → worktrees of the same repository. */
  gitWorktreesMap: Record<string, GitStatusRead<DeviceGitWorktreeListItem[]>>;
  gitWorktreesReplica: ReplicaState<GitStatusRead<DeviceGitWorktreeListItem[]>>;
}

export const initialGitStatusState: GitStatusStoreState = {
  gitAheadBehindMap: {},
  gitAheadBehindReplica: createReplicaState(),
  gitBranchListMap: {},
  gitBranchListReplica: createReplicaState(),
  gitBranchMap: {},
  gitBranchReplica: createReplicaState(),
  gitDiffStatsMap: {},
  gitDiffStatsReplica: createReplicaState(),
  gitRemoteBranchListMap: {},
  gitRemoteBranchListReplica: createReplicaState(),
  gitWorkingTreeStatusMap: {},
  gitWorkingTreeStatusReplica: createReplicaState(),
  gitWorktreesMap: {},
  gitWorktreesReplica: createReplicaState(),
};

export type GitStatusKind =
  | 'aheadBehind'
  | 'branch'
  | 'branches'
  | 'diffStats'
  | 'remoteBranches'
  | 'workingTreeStatus'
  | 'worktrees';

const createSlices = (
  set: (partial: Partial<GitStatusStore>, replace?: false, action?: any) => void,
  get: () => GitStatusStore,
) => ({
  aheadBehind: createReplicaSlice(gitAheadBehindResource, {
    actionPrefix: 'gitStatus/aheadBehind',
    fetcher: async (params: GitStatusParams) => ({
      value: await gitService.getGitAheadBehind(params),
    }),
    get,
    set,
    stateKey: 'gitAheadBehindReplica',
    view: recordLens<GitStatusStore, GitStatusRead<DeviceGitAheadBehind>>('gitAheadBehindMap'),
  }),
  branch: createReplicaSlice(gitBranchResource, {
    actionPrefix: 'gitStatus/branch',
    fetcher: async (params: GitStatusParams) => ({ value: await gitService.getGitBranch(params) }),
    get,
    set,
    stateKey: 'gitBranchReplica',
    view: recordLens<GitStatusStore, GitStatusRead<GitBranchSummary>>('gitBranchMap'),
  }),
  branches: createReplicaSlice(gitBranchListResource, {
    actionPrefix: 'gitStatus/branches',
    // A remote device that cannot answer rejects (the persisted list stays);
    // `[]` is a real answer (an unborn repository).
    fetcher: async (params: GitStatusParams) => ({
      value: await gitService.listGitBranches(params),
    }),
    get,
    set,
    stateKey: 'gitBranchListReplica',
    view: recordLens<GitStatusStore, GitStatusRead<DeviceGitBranchListItem[]>>('gitBranchListMap'),
  }),
  // No fetcher: the counts are written from the review-patch read that already
  // fetched them (see `useFetchGitDiffStats` + the GitStatus effect).
  diffStats: createReplicaSlice(gitDiffStatsResource, {
    actionPrefix: 'gitStatus/diffStats',
    get,
    set,
    stateKey: 'gitDiffStatsReplica',
    view: recordLens<GitStatusStore, GitStatusRead<GitDiffStats>>('gitDiffStatsMap'),
  }),
  remoteBranches: createReplicaSlice(gitRemoteBranchListResource, {
    actionPrefix: 'gitStatus/remoteBranches',
    // As for local branches: a failed read rejects, `[]` is "no origin".
    fetcher: async (params: GitStatusParams) => ({
      value: await gitService.listGitRemoteBranches(params),
    }),
    get,
    set,
    stateKey: 'gitRemoteBranchListReplica',
    view: recordLens<GitStatusStore, GitStatusRead<DeviceGitRemoteBranchListItem[]>>(
      'gitRemoteBranchListMap',
    ),
  }),
  workingTreeStatus: createReplicaSlice(gitWorkingTreeStatusResource, {
    actionPrefix: 'gitStatus/workingTreeStatus',
    fetcher: async (params: GitStatusParams) => ({
      value: await gitService.getGitWorkingTreeStatus(params),
    }),
    get,
    set,
    stateKey: 'gitWorkingTreeStatusReplica',
    view: recordLens<GitStatusStore, GitStatusRead<DeviceGitWorkingTreeStatus>>(
      'gitWorkingTreeStatusMap',
    ),
  }),
  worktrees: createReplicaSlice(gitWorktreesResource, {
    actionPrefix: 'gitStatus/worktrees',
    fetcher: async (params: GitStatusParams) => ({
      value: await gitService.listGitWorktrees(params),
    }),
    get,
    set,
    stateKey: 'gitWorktreesReplica',
    view: recordLens<GitStatusStore, GitStatusRead<DeviceGitWorktreeListItem[]>>('gitWorktreesMap'),
  }),
});

type GitStatusSlices = ReturnType<typeof createSlices>;

export interface GitStatusStore extends GitStatusStoreState {
  /**
   * Re-read a directory's local branch list after a branch write (create /
   * rename / delete / checkout), whether or not the switcher is open: the
   * persisted list must not paint a branch that is gone on the next open.
   */
  refreshGitBranches: (deviceId: string | undefined, path: string) => Promise<void>;
  /**
   * Re-run the mounted reads of one directory (all kinds by default) — after a
   * pull / push / checkout / worktree change made outside the hooks' own views.
   */
  revalidateGitStatus: (
    deviceId: string | undefined,
    path: string,
    kinds?: GitStatusKind[],
  ) => Promise<void>;
  /** @internal The replica slices; read through the hooks in `gitHooks.ts`. */
  slices: GitStatusSlices;
}

const ALL_KINDS: GitStatusKind[] = [
  'aheadBehind',
  'branch',
  'branches',
  'diffStats',
  'remoteBranches',
  'workingTreeStatus',
  'worktrees',
];

const devtools = createDevtools('gitStatus');

export const useGitStatusStore = createWithEqualityFn<GitStatusStore>()(
  devtools((set, get) => {
    const slices = createSlices(set, get);

    return {
      ...initialGitStatusState,
      refreshGitBranches: async (deviceId, path) => {
        try {
          await slices.branches.fetch({ deviceId, path }, { fresh: true });
        } catch {
          // Keep the last list; the next open re-reads an unreachable device.
        }
      },
      revalidateGitStatus: async (deviceId, path, kinds = ALL_KINDS) => {
        const key = gitStatusKey({ deviceId, path });
        await Promise.all(kinds.map((kind) => slices[kind].revalidate(key)));
      },
      slices,
    };
  }),
  shallow,
);

expose('gitStatus', useGitStatusStore);

export const getGitStatusStoreState = () => useGitStatusStore.getState();
