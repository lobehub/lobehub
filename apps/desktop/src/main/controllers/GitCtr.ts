import type {
  GetGitBranchDiffPayload,
  GitAddWorktreeResult,
  GitAheadBehind,
  GitBranchDiffPatches,
  GitBranchInfo,
  GitBranchListItem,
  GitCheckoutResult,
  GitDeleteBranchResult,
  GitFileRevertResult,
  GitLinkedPullRequestResult,
  GitPullResult,
  GitPushResult,
  GitRemoteBranchListItem,
  GitRemoveWorktreeResult,
  GitRenameBranchResult,
  GitWorkingTreeFiles,
  GitWorkingTreePatches,
  GitWorkingTreeStatus,
  GitWorktreeListItem,
} from '@lobechat/electron-client-ipc';
import {
  addGitWorktree as runAddGitWorktree,
  checkoutGitBranch as runCheckoutGitBranch,
  deleteGitBranch as runDeleteGitBranch,
  type DeviceGitInfo,
  getGitAheadBehind as computeGitAheadBehind,
  getGitBranch as computeGitBranch,
  getGitBranchDiff as runGitBranchDiff,
  getGitWorkingTreeFiles as computeGitWorkingTreeFiles,
  getGitWorkingTreePatches as computeGitWorkingTreePatches,
  getGitWorkingTreeStatus as computeGitWorkingTreeStatus,
  getLinkedPullRequest as computeLinkedPullRequest,
  gitInfo as computeGitInfo,
  listGitBranches as computeListGitBranches,
  listGitRemoteBranches as computeListGitRemoteBranches,
  listGitWorktrees as computeListGitWorktrees,
  pullGitBranch as runPullGitBranch,
  pushGitBranch as runPushGitBranch,
  removeGitWorktree as runRemoveGitWorktree,
  renameGitBranch as runRenameGitBranch,
  revertGitFile as runRevertGitFile,
} from '@lobechat/local-file-shell';

import { detectRepoType } from '@/utils/git';

import { ControllerModule, IpcMethod } from './index';

/**
 * GitController
 *
 * Thin IPC layer over `@lobechat/local-file-shell`'s git operations. Every
 * method delegates to the shared implementation so the local desktop IPC path,
 * the device-control RPC dispatch, and the CLI all run identical git logic.
 */
export default class GitController extends ControllerModule {
  static override readonly groupName = 'git';

  @IpcMethod()
  async detectRepoType(dirPath: string): Promise<'git' | 'github' | undefined> {
    return detectRepoType(dirPath);
  }

  @IpcMethod()
  async getGitBranch(dirPath: string): Promise<GitBranchInfo> {
    return computeGitBranch(dirPath);
  }

  @IpcMethod()
  async gitInfo(params: { isGithub?: boolean; scope: string }): Promise<DeviceGitInfo> {
    return computeGitInfo(params);
  }

  @IpcMethod()
  async getLinkedPullRequest(payload: {
    branch: string;
    path: string;
    pullRequestNumber?: number;
  }): Promise<GitLinkedPullRequestResult> {
    return computeLinkedPullRequest(payload);
  }

  @IpcMethod()
  async listGitBranches(dirPath: string): Promise<GitBranchListItem[]> {
    return computeListGitBranches(dirPath);
  }

  @IpcMethod()
  async listGitRemoteBranches(dirPath: string): Promise<GitRemoteBranchListItem[]> {
    return computeListGitRemoteBranches(dirPath);
  }

  @IpcMethod()
  async listGitWorktrees(dirPath: string): Promise<GitWorktreeListItem[]> {
    return computeListGitWorktrees(dirPath);
  }

  @IpcMethod()
  async getGitWorkingTreeStatus(dirPath: string): Promise<GitWorkingTreeStatus> {
    return computeGitWorkingTreeStatus(dirPath);
  }

  @IpcMethod()
  async getGitWorkingTreeFiles(dirPath: string): Promise<GitWorkingTreeFiles> {
    return computeGitWorkingTreeFiles(dirPath);
  }

  @IpcMethod()
  async getGitWorkingTreePatches(dirPath: string): Promise<GitWorkingTreePatches> {
    return computeGitWorkingTreePatches(dirPath);
  }

  @IpcMethod()
  async getGitBranchDiff(payload: GetGitBranchDiffPayload): Promise<GitBranchDiffPatches> {
    return runGitBranchDiff(payload);
  }

  @IpcMethod()
  async getGitAheadBehind(dirPath: string): Promise<GitAheadBehind> {
    return computeGitAheadBehind(dirPath);
  }

  @IpcMethod()
  async checkoutGitBranch(payload: {
    branch: string;
    create?: boolean;
    path: string;
  }): Promise<GitCheckoutResult> {
    return runCheckoutGitBranch(payload);
  }

  @IpcMethod()
  async renameGitBranch(payload: {
    from: string;
    path: string;
    to: string;
  }): Promise<GitRenameBranchResult> {
    return runRenameGitBranch(payload);
  }

  @IpcMethod()
  async deleteGitBranch(payload: { branch: string; path: string }): Promise<GitDeleteBranchResult> {
    return runDeleteGitBranch(payload);
  }

  @IpcMethod()
  async removeGitWorktree(payload: {
    path: string;
    worktreePath: string;
  }): Promise<GitRemoveWorktreeResult> {
    return runRemoveGitWorktree(payload);
  }

  @IpcMethod()
  async addGitWorktree(payload: {
    branch: string;
    path: string;
    worktreePath: string;
  }): Promise<GitAddWorktreeResult> {
    return runAddGitWorktree(payload);
  }

  @IpcMethod()
  async pullGitBranch(payload: { path: string }): Promise<GitPullResult> {
    return runPullGitBranch(payload);
  }

  @IpcMethod()
  async pushGitBranch(payload: { path: string }): Promise<GitPushResult> {
    return runPushGitBranch(payload);
  }

  @IpcMethod()
  async revertGitFile(payload: { filePath: string; path: string }): Promise<GitFileRevertResult> {
    return runRevertGitFile(payload);
  }
}
