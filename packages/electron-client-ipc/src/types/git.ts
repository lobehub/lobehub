export interface GitBranchInfo {
  /** Branch short name, or short SHA when in detached HEAD state */
  branch?: string;
  /** True when HEAD is detached (no branch ref) */
  detached?: boolean;
}

export interface GitLinkedPullRequest {
  number: number;
  state: string;
  title: string;
  url: string;
}

export interface GitLinkedPullRequestResult {
  /** Additional open PRs targeting the same head branch, beyond the primary one */
  extraCount?: number;
  /** Null when no open PR is linked to the branch */
  pullRequest: GitLinkedPullRequest | null;
  /** 'ok' — lookup succeeded; 'gh-missing' — gh CLI unavailable / not authed; 'error' — other failure */
  status: 'ok' | 'gh-missing' | 'error';
}

export interface GitBranchListItem {
  current: boolean;
  name: string;
  upstream?: string;
}

export interface GitWorkingTreeStatus {
  /** Untracked + staged-as-added files */
  added: number;
  clean: boolean;
  /** Files marked deleted in either index or working tree */
  deleted: number;
  /** Modified / renamed / copied / type-changed / unmerged files */
  modified: number;
  /** Total dirty files (each file counted once) — sum of added + modified + deleted */
  total: number;
}

export interface GitWorkingTreeFiles {
  /** Repo-relative paths for untracked + staged-as-added files */
  added: string[];
  /** Repo-relative paths for files marked deleted in either index or working tree */
  deleted: string[];
  /** Repo-relative paths for modified / renamed / copied / type-changed / unmerged files */
  modified: string[];
}

export interface GitCheckoutResult {
  error?: string;
  success: boolean;
}

export interface GitPullResult {
  error?: string;
  /** True when `git pull` reported the branch was already up-to-date */
  noop?: boolean;
  success: boolean;
}

export interface GitPushResult {
  error?: string;
  /** True when `git push` reported everything is already up-to-date */
  noop?: boolean;
  success: boolean;
}

export interface GitAheadBehind {
  /** Commits in HEAD not in upstream — push count */
  ahead: number;
  /** Commits in upstream not in HEAD — pull count */
  behind: number;
  /** True when the branch has an upstream tracking ref configured */
  hasUpstream: boolean;
  /**
   * Ref the one-click push action would actually target — always
   * `origin/<current-branch-name>`, because we use `git push -u origin HEAD`.
   * May differ from `upstream` (e.g. branch created via
   * `git checkout -b feat/x origin/canary`). Undefined when detached.
   */
  pushTarget?: string;
  /**
   * True when `pushTarget` already exists as a remote-tracking ref. False
   * means clicking push would create a new remote branch.
   */
  pushTargetExists?: boolean;
  /** Upstream ref short name (e.g. `origin/main`), when available */
  upstream?: string;
}
