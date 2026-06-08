import type {
  DeviceGitAheadBehind,
  DeviceGitBranchListItem,
  DeviceGitCheckoutResult,
  DeviceGitLinkedPullRequest,
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
}

export const gitService = new GitService();
