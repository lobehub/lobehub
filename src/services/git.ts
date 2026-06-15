import type {
  GitBranchDiffPatches,
  GitFileRevertResult,
  GitRemoteBranchListItem,
  GitWorkingTreeFiles,
  GitWorkingTreePatches,
} from '@lobechat/electron-client-ipc';
import type {
  DeviceGitAheadBehind,
  DeviceGitBranchListItem,
  DeviceGitCheckoutResult,
  DeviceGitDeleteBranchResult,
  DeviceGitLinkedPullRequest,
  DeviceGitRenameBranchResult,
  DeviceGitSyncResult,
  DeviceGitWorkingTreeStatus,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import { electronGitService } from '@/services/electron/git';

/** Branch + linked-PR summary, composed from the branch and PR reads. */
export interface GitInfo {
  branch?: string;
  detached?: boolean;
  extraCount?: number;
  ghMissing?: boolean;
  pullRequest?: DeviceGitLinkedPullRequest | null;
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
   * Branch + linked PR summary. Composes a branch read with a conditional PR
   * lookup (skipped for detached HEAD / non-github repos) — both legs dispatch
   * per `deviceId`, so the gh-CLI lookup runs on whichever machine owns the repo.
   */
  async getGitInfo({
    deviceId,
    isGithub,
    path,
  }: {
    deviceId?: string;
    isGithub?: boolean;
    path: string;
  }): Promise<GitInfo> {
    const branchInfo = deviceId
      ? await lambdaClient.device.gitBranch.query({ deviceId, path })
      : await electronGitService.getGitBranch(path);
    const branch = branchInfo?.branch;
    const detached = branchInfo?.detached;
    if (!branch) return {};

    // Skip the PR lookup for detached HEAD or non-github repos.
    if (detached || !isGithub) return { branch, detached };

    const pr = deviceId
      ? await lambdaClient.device.gitLinkedPullRequest.query({ branch, deviceId, path })
      : await electronGitService.getLinkedPullRequest({ branch, path });
    if (!pr) return { branch, detached };

    return {
      branch,
      detached,
      extraCount: pr.extraCount,
      ghMissing: pr.status === 'gh-missing',
      pullRequest: pr.pullRequest,
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
