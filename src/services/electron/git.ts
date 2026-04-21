import {
  type GitAheadBehind,
  type GitBranchInfo,
  type GitBranchListItem,
  type GitCheckoutResult,
  type GitLinkedPullRequestResult,
  type GitWorkingTreeFiles,
  type GitWorkingTreeStatus,
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
  }): Promise<GitLinkedPullRequestResult> {
    return this.ipc.git.getLinkedPullRequest(params);
  }

  async listGitBranches(dirPath: string): Promise<GitBranchListItem[]> {
    return this.ipc.git.listGitBranches(dirPath);
  }

  async getGitWorkingTreeStatus(dirPath: string): Promise<GitWorkingTreeStatus> {
    return this.ipc.git.getGitWorkingTreeStatus(dirPath);
  }

  async getGitWorkingTreeFiles(dirPath: string): Promise<GitWorkingTreeFiles> {
    return this.ipc.git.getGitWorkingTreeFiles(dirPath);
  }

  async getGitAheadBehind(dirPath: string): Promise<GitAheadBehind> {
    return this.ipc.git.getGitAheadBehind(dirPath);
  }

  async checkoutGitBranch(params: {
    branch: string;
    create?: boolean;
    path: string;
  }): Promise<GitCheckoutResult> {
    return this.ipc.git.checkoutGitBranch(params);
  }
}

export const electronGitService = new ElectronGitService();
