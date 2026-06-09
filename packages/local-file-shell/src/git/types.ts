/** Branch short name (or short SHA when detached). */
export interface GitBranchInfo {
  branch?: string;
  detached?: boolean;
}

export interface GitLinkedPullRequest {
  number: number;
  state: string;
  title: string;
  url: string;
}

export interface GitLinkedPullRequestResult {
  /** Additional open PRs targeting the same head branch, beyond the primary one. */
  extraCount?: number;
  /** Null when no open PR is linked to the branch. */
  pullRequest: GitLinkedPullRequest | null;
  /** 'ok' — succeeded; 'gh-missing' — gh CLI unavailable / not authed; 'error' — other. */
  status: 'ok' | 'gh-missing' | 'error';
}

export interface GitWorkingTreeStatus {
  added: number;
  clean: boolean;
  deleted: number;
  modified: number;
  total: number;
}

export interface GitAheadBehind {
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  pushTarget?: string;
  pushTargetExists?: boolean;
  upstream?: string;
}

/**
 * Aggregate git status for a working directory — the single payload behind both
 * the desktop git display and the device `gitInfo` RPC (and CLI). Mirrors the
 * three renderer hooks (`useGitInfo` / `useWorkingTreeStatus` / `useGitAheadBehind`).
 */
export interface DeviceGitInfo {
  aheadBehind: GitAheadBehind;
  info: {
    branch?: string;
    detached?: boolean;
    extraCount?: number;
    ghMissing?: boolean;
    pullRequest?: GitLinkedPullRequest | null;
  };
  workingStatus: GitWorkingTreeStatus;
}
