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
import type { DeviceGitInfo } from '@lobechat/local-file-shell/git';

import { ControllerModule, IpcMethod } from './index';

const loadGit = () => import('@lobechat/local-file-shell/git');

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
    const { detectRepoType } = await loadGit();
    return detectRepoType(dirPath);
  }

  @IpcMethod()
  async getGitBranch(dirPath: string): Promise<GitBranchInfo> {
    const { getGitBranch: computeGitBranch } = await loadGit();
    return computeGitBranch(dirPath);
  }

  @IpcMethod()
  async gitInfo(params: { isGithub?: boolean; scope: string }): Promise<DeviceGitInfo> {
    const { gitInfo: computeGitInfo } = await loadGit();
    return computeGitInfo(params);
  }

  @IpcMethod()
  async getLinkedPullRequest(payload: {
    branch: string;
    path: string;
    pullRequestNumber?: number;
  }): Promise<GitLinkedPullRequestResult> {
    const { getLinkedPullRequest: computeLinkedPullRequest } = await loadGit();
    return computeLinkedPullRequest(payload);
  }

  @IpcMethod()
  async listGitBranches(dirPath: string): Promise<GitBranchListItem[]> {
    const { listGitBranches: computeListGitBranches } = await loadGit();
    return computeListGitBranches(dirPath);
  }

  @IpcMethod()
  async listGitRemoteBranches(dirPath: string): Promise<GitRemoteBranchListItem[]> {
    const { listGitRemoteBranches: computeListGitRemoteBranches } = await loadGit();
    return computeListGitRemoteBranches(dirPath);
  }

  @IpcMethod()
  async listGitWorktrees(dirPath: string): Promise<GitWorktreeListItem[]> {
    const { listGitWorktrees: computeListGitWorktrees } = await loadGit();
    return computeListGitWorktrees(dirPath);
  }

  @IpcMethod()
  async getGitWorkingTreeStatus(dirPath: string): Promise<GitWorkingTreeStatus> {
    const { getGitWorkingTreeStatus: computeGitWorkingTreeStatus } = await loadGit();
    return computeGitWorkingTreeStatus(dirPath);
  }

  @IpcMethod()
  async getGitWorkingTreeFiles(dirPath: string): Promise<GitWorkingTreeFiles> {
    const { getGitWorkingTreeFiles: computeGitWorkingTreeFiles } = await loadGit();
    return computeGitWorkingTreeFiles(dirPath);
  }

  @IpcMethod()
  async getGitWorkingTreePatches(dirPath: string): Promise<GitWorkingTreePatches> {
    const { getGitWorkingTreePatches: computeGitWorkingTreePatches } = await loadGit();
    return computeGitWorkingTreePatches(dirPath);
  }

  @IpcMethod()
  async getGitBranchDiff(payload: GetGitBranchDiffPayload): Promise<GitBranchDiffPatches> {
    const { getGitBranchDiff: runGitBranchDiff } = await loadGit();
    return runGitBranchDiff(payload);
  }

  @IpcMethod()
  async getGitAheadBehind(dirPath: string): Promise<GitAheadBehind> {
    const { getGitAheadBehind: computeGitAheadBehind } = await loadGit();
    return computeGitAheadBehind(dirPath);
  }

  @IpcMethod()
  async checkoutGitBranch(payload: {
    branch: string;
    create?: boolean;
    path: string;
  }): Promise<GitCheckoutResult> {
    const { checkoutGitBranch: runCheckoutGitBranch } = await loadGit();
    return runCheckoutGitBranch(payload);
  }

  @IpcMethod()
  async renameGitBranch(payload: {
    from: string;
    path: string;
    to: string;
  }): Promise<GitRenameBranchResult> {
    const { renameGitBranch: runRenameGitBranch } = await loadGit();
    return runRenameGitBranch(payload);
  }

  @IpcMethod()
  async deleteGitBranch(payload: { branch: string; path: string }): Promise<GitDeleteBranchResult> {
    const { deleteGitBranch: runDeleteGitBranch } = await loadGit();
    return runDeleteGitBranch(payload);
  }

  @IpcMethod()
  async removeGitWorktree(payload: {
    path: string;
    worktreePath: string;
  }): Promise<GitRemoveWorktreeResult> {
    const { removeGitWorktree: runRemoveGitWorktree } = await loadGit();
    return runRemoveGitWorktree(payload);
  }

  @IpcMethod()
  async addGitWorktree(payload: {
    branch: string;
    path: string;
    worktreePath: string;
  }): Promise<GitAddWorktreeResult> {
    const { addGitWorktree: runAddGitWorktree } = await loadGit();
    return runAddGitWorktree(payload);
  }

  @IpcMethod()
  async pullGitBranch(payload: { path: string }): Promise<GitPullResult> {
    const { pullGitBranch: runPullGitBranch } = await loadGit();
    return runPullGitBranch(payload);
  }

  @IpcMethod()
  async pushGitBranch(payload: { path: string }): Promise<GitPushResult> {
    const { pushGitBranch: runPushGitBranch } = await loadGit();
    return runPushGitBranch(payload);
  }

  @IpcMethod()
  async revertGitFile(payload: { filePath: string; path: string }): Promise<GitFileRevertResult> {
    const { revertGitFile: runRevertGitFile } = await loadGit();
    return runRevertGitFile(payload);
  }
}
