import type {
  GitBranchDiffPatches,
  GitFileRevertResult,
  GitRemoteBranchListItem,
  GitWorkingTreeFiles,
  GitWorkingTreePatches,
} from '@lobechat/electron-client-ipc';
import type {
  DeviceGitAddWorktreeResult,
  DeviceGitAheadBehind,
  DeviceGitBranchListItem,
  DeviceGitCheckoutResult,
  DeviceGitDeleteBranchResult,
  DeviceGitLinkedPullRequest,
  DeviceGitLinkedPullRequestLookupStatus,
  DeviceGitRemoveWorktreeResult,
  DeviceGitRenameBranchResult,
  DeviceGitSyncResult,
  DeviceGitWorkingTreeStatus,
  DeviceGitWorktreeListItem,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import { electronGitService } from '@/services/electron/git';

/** Current branch + detached-HEAD state for a working directory (cheap read). */
export interface GitBranchSummary {
  branch?: string;
  detached?: boolean;
}

/** Linked-PR summary for a branch — the result of the expensive `gh` leg. */
export interface GitLinkedPRSummary {
  extraCount?: number;
  ghMissing?: boolean;
  pullRequest?: DeviceGitLinkedPullRequest | null;
  pullRequestStatus?: DeviceGitLinkedPullRequestLookupStatus;
}

/**
 * Git operations chokepoint. Each call picks its own transport from `deviceId`:
 * a remote / web target (deviceId set) goes through the `device.*` TRPC RPCs;
 * the local desktop talks to Electron over IPC. UI / store / hooks only see this
 * service — the electron-vs-lambda decision never leaks up. Reads and writes are
 * symmetric: both transports expose the same granular git operations.
 */
class GitService {
  /** Local branches of a working directory. */
  listGitBranches({
    deviceId,
    path,
  }: {
    deviceId?: string;
    path: string;
  }): Promise<DeviceGitBranchListItem[]> {
    return deviceId
      ? lambdaClient.device.listGitBranches.query({ deviceId, path })
      : electronGitService.listGitBranches(path);
  }

  /** Checkout (or create) a branch in a working directory. */
  checkoutGitBranch({
    branch,
    create,
    deviceId,
    path,
  }: {
    branch: string;
    create?: boolean;
    deviceId?: string;
    path: string;
  }): Promise<DeviceGitCheckoutResult> {
    return deviceId
      ? lambdaClient.device.checkoutGitBranch.mutate({ branch, create, deviceId, path })
      : electronGitService.checkoutGitBranch({ branch, create, path });
  }

  /** Rename a branch in a working directory. */
  renameGitBranch({
    deviceId,
    from,
    path,
    to,
  }: {
    deviceId?: string;
    from: string;
    path: string;
    to: string;
  }): Promise<DeviceGitRenameBranchResult> {
    return deviceId
      ? lambdaClient.device.renameGitBranch.mutate({ deviceId, from, path, to })
      : electronGitService.renameGitBranch({ from, path, to });
  }

  /** Delete a branch in a working directory. */
  deleteGitBranch({
    branch,
    deviceId,
    path,
  }: {
    branch: string;
    deviceId?: string;
    path: string;
  }): Promise<DeviceGitDeleteBranchResult> {
    return deviceId
      ? lambdaClient.device.deleteGitBranch.mutate({ branch, deviceId, path })
      : electronGitService.deleteGitBranch({ branch, path });
  }

  /** Remove a worktree from a working directory's repository. */
  removeGitWorktree({
    deviceId,
    path,
    worktreePath,
  }: {
    deviceId?: string;
    path: string;
    worktreePath: string;
  }): Promise<DeviceGitRemoveWorktreeResult> {
    return deviceId
      ? lambdaClient.device.removeGitWorktree.mutate({ deviceId, path, worktreePath })
      : electronGitService.removeGitWorktree({ path, worktreePath });
  }

  /**
   * Add a linked worktree on a fresh branch to a working directory's repository.
   * A remote device derives the target path server-side from `path` + `branch`
   * (never trusting a client-supplied absolute path), so `worktreePath` is only
   * forwarded on the local IPC route where this machine owns the filesystem.
   */
  addGitWorktree({
    branch,
    deviceId,
    path,
    worktreePath,
  }: {
    branch: string;
    deviceId?: string;
    path: string;
    worktreePath: string;
  }): Promise<DeviceGitAddWorktreeResult> {
    return deviceId
      ? lambdaClient.device.addGitWorktree.mutate({ branch, deviceId, path })
      : electronGitService.addGitWorktree({ branch, path, worktreePath });
  }

  /** Pull (`--ff-only`) the current branch of a working directory. */
  pullGitBranch({
    deviceId,
    path,
  }: {
    deviceId?: string;
    path: string;
  }): Promise<DeviceGitSyncResult> {
    return deviceId
      ? lambdaClient.device.pullGitBranch.mutate({ deviceId, path })
      : electronGitService.pullGitBranch({ path });
  }

  /** Push the current branch of a working directory. */
  pushGitBranch({
    deviceId,
    path,
  }: {
    deviceId?: string;
    path: string;
  }): Promise<DeviceGitSyncResult> {
    return deviceId
      ? lambdaClient.device.pushGitBranch.mutate({ deviceId, path })
      : electronGitService.pushGitBranch({ path });
  }

  /**
   * Current branch + detached-HEAD state. A cheap local git read, deliberately
   * split from the linked-PR lookup so the branch label can revalidate promptly
   * on a working-directory switch without re-triggering the expensive `gh` call.
   * Dispatches per `deviceId` like every other leg.
   */
  async getGitBranch({
    deviceId,
    path,
  }: {
    deviceId?: string;
    path: string;
  }): Promise<GitBranchSummary> {
    const info = deviceId
      ? await lambdaClient.device.gitBranch.query({ deviceId, path })
      : await electronGitService.getGitBranch(path);
    return { branch: info?.branch, detached: info?.detached };
  }

  /**
   * PR linked to `branch` on a GitHub repo. Shells out to `gh pr list` (8s
   * timeout), so callers throttle this far more aggressively than the branch
   * read. Includes merged/closed PRs so persisted snapshots can refresh after
   * GitHub changes outside the app.
   */
  async getLinkedPullRequest({
    branch,
    deviceId,
    path,
    pullRequestNumber,
  }: {
    branch: string;
    deviceId?: string;
    path: string;
    pullRequestNumber?: number;
  }): Promise<GitLinkedPRSummary | undefined> {
    const pr = deviceId
      ? await lambdaClient.device.gitLinkedPullRequest.query({
          branch,
          deviceId,
          path,
          pullRequestNumber,
        })
      : await electronGitService.getLinkedPullRequest({ branch, path, pullRequestNumber });
    if (!pr) return undefined;
    return {
      extraCount: pr.extraCount,
      ghMissing: pr.status === 'gh-missing',
      pullRequest: pr.pullRequest,
      pullRequestStatus: pr.status,
    };
  }

  /** Working-tree dirty-file counts for a working directory. */
  async getGitWorkingTreeStatus({
    deviceId,
    path,
  }: {
    deviceId?: string;
    path: string;
  }): Promise<DeviceGitWorkingTreeStatus | undefined> {
    return deviceId
      ? ((await lambdaClient.device.gitWorkingTreeStatus.query({ deviceId, path })) ?? undefined)
      : electronGitService.getGitWorkingTreeStatus(path);
  }

  /** Ahead/behind commit counts for the current branch vs its upstream. */
  async getGitAheadBehind({
    deviceId,
    path,
  }: {
    deviceId?: string;
    path: string;
  }): Promise<DeviceGitAheadBehind | undefined> {
    return deviceId
      ? ((await lambdaClient.device.gitAheadBehind.query({ deviceId, path })) ?? undefined)
      : electronGitService.getGitAheadBehind(path);
  }

  /** Working-tree (unstaged) per-file patches for a working directory. */
  async getGitWorkingTreePatches({
    deviceId,
    path,
  }: {
    deviceId?: string;
    path: string;
  }): Promise<GitWorkingTreePatches | undefined> {
    return deviceId
      ? ((await lambdaClient.device.getGitWorkingTreePatches.query({ deviceId, path })) ??
          undefined)
      : electronGitService.getGitWorkingTreePatches(path);
  }

  /** Repo-relative paths of dirty working-tree files (the Files tab git overlay). */
  async getGitWorkingTreeFiles({
    deviceId,
    path,
  }: {
    deviceId?: string;
    path: string;
  }): Promise<GitWorkingTreeFiles | undefined> {
    return deviceId
      ? ((await lambdaClient.device.getGitWorkingTreeFiles.query({ deviceId, path })) ?? undefined)
      : electronGitService.getGitWorkingTreeFiles(path);
  }

  /** Branch diff (current branch vs base ref) per-file patches for a working directory. */
  async getGitBranchDiff({
    baseRef,
    deviceId,
    path,
  }: {
    baseRef?: string;
    deviceId?: string;
    path: string;
  }): Promise<GitBranchDiffPatches | undefined> {
    return deviceId
      ? ((await lambdaClient.device.getGitBranchDiff.query({ baseRef, deviceId, path })) ??
          undefined)
      : electronGitService.getGitBranchDiff({ baseRef, path });
  }

  /** Remote branches (`refs/remotes/origin/*`) of a working directory. */
  listGitRemoteBranches({
    deviceId,
    path,
  }: {
    deviceId?: string;
    path: string;
  }): Promise<GitRemoteBranchListItem[]> {
    return deviceId
      ? lambdaClient.device.listGitRemoteBranches.query({ deviceId, path })
      : electronGitService.listGitRemoteBranches(path);
  }

  /** Git worktrees attached to the same repository as a working directory. */
  listGitWorktrees({
    deviceId,
    path,
  }: {
    deviceId?: string;
    path: string;
  }): Promise<DeviceGitWorktreeListItem[]> {
    return deviceId
      ? lambdaClient.device.listGitWorktrees.query({ deviceId, path })
      : electronGitService.listGitWorktrees(path);
  }

  /** Revert (discard working-tree changes to) a single file in a working directory. */
  revertGitFile({
    deviceId,
    filePath,
    path,
  }: {
    deviceId?: string;
    filePath: string;
    path: string;
  }): Promise<GitFileRevertResult> {
    return deviceId
      ? lambdaClient.device.revertGitFile.mutate({ deviceId, filePath, path })
      : electronGitService.revertGitFile({ filePath, path });
  }
}

export const gitService = new GitService();
