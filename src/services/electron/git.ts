import {
  type GetGitBranchDiffPayload,
  type GitAddWorktreeResult,
  type GitAheadBehind,
  type GitBranchDiffPatches,
  type GitBranchInfo,
  type GitBranchListItem,
  type GitCheckoutResult,
  type GitDeleteBranchResult,
  type GitFileRevertResult,
  type GitLinkedPullRequestResult,
  type GitOwnedWorktreeCleanupResult,
  type GitOwnedWorktreeRestoreResult,
  type GitPullRequestAction,
  type GitPullRequestActionResult,
  type GitPullRequestActivity,
  type GitPullRequestDetailResult,
  type GitPullRequestMergeContext,
  type GitPullResult,
  type GitPushResult,
  type GitRemoteBranchListItem,
  type GitRemoveWorktreeResult,
  type GitRenameBranchResult,
  type GitWorkingTreeFiles,
  type GitWorkingTreePatches,
  type GitWorkingTreeStatus,
  type GitWorktreeListItem,
} from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

/**
 * Renderer-side wrapper for the `git.*` IPC group exposed by GitController.
 * Kept separate from ElectronSystemService so that git concerns don't leak
 * back into the system/windows/menu surface.
 */
class ElectronGitService {
  private get ipc() {
    return ensureElectronIpc();
  }

  async detectRepoType(dirPath: string): Promise<'git' | 'github' | undefined> {
    return this.ipc.git.detectRepoType(dirPath);
  }

  async getGitBranch(dirPath: string): Promise<GitBranchInfo> {
    return this.ipc.git.getGitBranch(dirPath);
  }

  async getLinkedPullRequest(params: {
    branch: string;
    path: string;
    pullRequestNumber?: number;
    state?: 'all' | 'open';
  }): Promise<GitLinkedPullRequestResult> {
    return this.ipc.git.getLinkedPullRequest(params);
  }

  async getPullRequestDetail(params: {
    coreOnly?: boolean;
    number: number;
    path: string;
  }): Promise<GitPullRequestDetailResult> {
    return this.ipc.git.getPullRequestDetail(params);
  }

  async getPullRequestActivity(params: {
    number: number;
    path: string;
  }): Promise<GitPullRequestActivity> {
    return this.ipc.git.getPullRequestActivity(params);
  }

  async getPullRequestMergeContext(params: {
    baseRefName: string;
    headRefOid: string;
    number: number;
    path: string;
    repo: { name: string; owner: string };
  }): Promise<GitPullRequestMergeContext> {
    return this.ipc.git.getPullRequestMergeContext(params);
  }

  async runPullRequestAction(params: {
    action: GitPullRequestAction;
    number: number;
    path: string;
  }): Promise<GitPullRequestActionResult> {
    return this.ipc.git.runPullRequestAction(params);
  }

  async listGitBranches(dirPath: string): Promise<GitBranchListItem[]> {
    return this.ipc.git.listGitBranches(dirPath);
  }

  async listGitRemoteBranches(dirPath: string): Promise<GitRemoteBranchListItem[]> {
    return this.ipc.git.listGitRemoteBranches(dirPath);
  }

  async listGitWorktrees(dirPath: string): Promise<GitWorktreeListItem[]> {
    return this.ipc.git.listGitWorktrees(dirPath);
  }

  async getGitWorkingTreeStatus(dirPath: string): Promise<GitWorkingTreeStatus> {
    return this.ipc.git.getGitWorkingTreeStatus(dirPath);
  }

  async getGitWorkingTreeFiles(dirPath: string): Promise<GitWorkingTreeFiles> {
    return this.ipc.git.getGitWorkingTreeFiles(dirPath);
  }

  async getGitWorkingTreePatches(dirPath: string): Promise<GitWorkingTreePatches> {
    return this.ipc.git.getGitWorkingTreePatches(dirPath);
  }

  async getGitBranchDiff(payload: GetGitBranchDiffPayload): Promise<GitBranchDiffPatches> {
    return this.ipc.git.getGitBranchDiff(payload);
  }

  /**
   * Counts for HEAD, or for `branch` when named. A HEAD read keeps sending the
   * bare path so a main process that predates the branch option still answers.
   */
  async getGitAheadBehind(dirPath: string, branch?: string): Promise<GitAheadBehind> {
    return this.ipc.git.getGitAheadBehind(
      branch === undefined ? dirPath : { branch, path: dirPath },
    );
  }

  async checkoutGitBranch(params: {
    branch: string;
    create?: boolean;
    path: string;
    startPoint?: string;
  }): Promise<GitCheckoutResult> {
    return this.ipc.git.checkoutGitBranch(params);
  }

  async pullGitBranch(params: { branch?: string; path: string }): Promise<GitPullResult> {
    return this.ipc.git.pullGitBranch(params);
  }

  async pushGitBranch(params: { branch?: string; path: string }): Promise<GitPushResult> {
    return this.ipc.git.pushGitBranch(params);
  }

  async revertGitFile(params: { filePath: string; path: string }): Promise<GitFileRevertResult> {
    return this.ipc.git.revertGitFile(params);
  }

  async renameGitBranch(params: {
    from: string;
    path: string;
    to: string;
  }): Promise<GitRenameBranchResult> {
    return this.ipc.git.renameGitBranch(params);
  }

  async deleteGitBranch(params: { branch: string; path: string }): Promise<GitDeleteBranchResult> {
    return this.ipc.git.deleteGitBranch(params);
  }

  async removeGitWorktree(params: {
    path: string;
    worktreePath: string;
  }): Promise<GitRemoveWorktreeResult> {
    return this.ipc.git.removeGitWorktree(params);
  }

  async addGitWorktree(params: {
    branch: string;
    ownerToken?: string;
    path: string;
    startPoint?: string;
    worktreePath: string;
  }): Promise<GitAddWorktreeResult> {
    return this.ipc.git.addGitWorktree(params);
  }

  async cleanupOwnedWorktree(params: {
    discard?: boolean;
    ownerToken?: string;
    sourcePath: string;
    worktreePath: string;
  }): Promise<GitOwnedWorktreeCleanupResult> {
    return this.ipc.git.cleanupOwnedWorktree(params);
  }

  async restoreOwnedWorktree(params: {
    branch: string;
    ownerToken?: string;
    sourcePath: string;
    worktreePath: string;
  }): Promise<GitOwnedWorktreeRestoreResult> {
    return this.ipc.git.restoreOwnedWorktree(params);
  }
}

export const electronGitService = new ElectronGitService();
