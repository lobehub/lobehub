/**
 * The remote ref a local branch publishes to. Stored instead of (not as well as)
 * relying on the local branch name, which is a device-local label — a worktree's
 * generated name or an explicit-refspec push makes it differ from the branch that
 * actually exists on the remote, and only the remote ref means anything off this
 * machine.
 */
export interface GitUpstreamRef {
  /** Branch name ON the remote (`feat/x`), never the local name. */
  branch: string;
  /** Remote name (`origin`). */
  remote: string;
}

/** Branch short name (or short SHA when detached). */
export interface GitBranchInfo {
  branch?: string;
  detached?: boolean;
  /** Remote ref the branch publishes to. Absent when unpushed or unresolvable. */
  upstream?: GitUpstreamRef;
}

export type GitPullRequestCiStatus = 'failure' | 'pending' | 'success' | 'unknown';

export interface GitLinkedPullRequest {
  ciStatus?: GitPullRequestCiStatus;
  isDraft?: boolean;
  mergeable?: string;
  mergedAt?: string | null;
  mergeStateStatus?: string;
  number: number;
  reviewDecision?: string;
  state: string;
  title: string;
  url: string;
}

export type GitLinkedPullRequestLookupStatus = 'ok' | 'gh-missing' | 'error';

export interface GitLinkedPullRequestResult {
  /** Additional PRs targeting the same head branch, beyond the primary one. */
  extraCount?: number;
  /** Null when no PR is linked to the branch. */
  pullRequest: GitLinkedPullRequest | null;
  /** 'ok' — succeeded; 'gh-missing' — gh CLI unavailable / not authed; 'error' — other. */
  status: GitLinkedPullRequestLookupStatus;
  /**
   * Remote ref the lookup actually queried under. Reported back so a caller can
   * persist it — the PR's own head ref is the most authoritative answer available,
   * and it is the only one that survives a commit→PR recovery on a machine with no
   * local trace of the push.
   */
  upstream?: GitUpstreamRef;
}

export interface GitWorkingTreeStatus {
  added: number;
  clean: boolean;
  deleted: number;
  modified: number;
  total: number;
}

export interface GitWorktreeListItem {
  bare?: boolean;
  branch?: string;
  current: boolean;
  detached?: boolean;
  head?: string;
  locked?: boolean;
  lockReason?: string;
  path: string;
  prunable?: boolean;
  pruneReason?: string;
  status?: GitWorkingTreeStatus;
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
    upstream?: GitUpstreamRef;
  };
  workingStatus: GitWorkingTreeStatus;
}

export interface GitBranchListItem {
  current: boolean;
  name: string;
  upstream?: string;
}

export interface GitRemoteBranchListItem {
  /** Whether this ref is the resolved default branch (origin/HEAD target). */
  isDefault: boolean;
  /** Short ref name, e.g. `origin/canary`. */
  name: string;
}

export interface GitWorkingTreeFiles {
  /** Repo-relative paths for untracked + staged-as-added files */
  added: string[];
  /** Repo-relative paths for files marked deleted in either index or working tree */
  deleted: string[];
  /** Repo-relative paths for modified / renamed / copied / type-changed / unmerged files */
  modified: string[];
}

export type GitFileDiffStatus = 'added' | 'modified' | 'deleted';

export interface GitWorkingTreePatch {
  /** Number of `+` lines in the patch (excluding the `+++ b/...` header). */
  additions: number;
  /** Number of `-` lines in the patch (excluding the `--- a/...` header). */
  deletions: number;
  /** Repo-relative path of the file. */
  filePath: string;
  /**
   * True when git reported `Binary files … differ` for this entry — the UI
   * should show a placeholder instead of a textual diff.
   */
  isBinary: boolean;
  /**
   * Unified diff patch text exactly as `git diff` produced it (including the
   * `diff --git` header line). Empty when isBinary or truncated.
   */
  patch: string;
  /** Same status bucket as GitWorkingTreeFiles. */
  status: GitFileDiffStatus;
  /** Patch was elided because it exceeded the per-file size cap. */
  truncated: boolean;
}

/**
 * Patches collected from a dirty submodule of the parent repo. The submodule
 * itself is a self-contained git repo, so its patches use the same
 * `GitWorkingTreePatch` shape; we only add metadata the renderer needs to tag
 * the group and route per-file ops (revert, etc.) into the right working dir.
 */
export interface SubmoduleWorkingTreePatches {
  /** Absolute path on disk — used as the `cwd` for revert / branch operations. */
  absolutePath: string;
  /** Current branch short name inside the submodule, or short SHA when detached. */
  branch?: string;
  /** True when the submodule's HEAD is detached (no branch ref). */
  detached?: boolean;
  /** Display name — the submodule's directory basename. */
  name: string;
  /** Per-file diff blocks inside this submodule, same ordering as the parent's `patches`. */
  patches: GitWorkingTreePatch[];
  /** Path relative to the parent repo root (e.g. `lobehub` or `packages/foo`). */
  relativePath: string;
}

export interface GitWorkingTreePatches {
  /**
   * All dirty file patches in the parent repo, ordered added → modified →
   * deleted. Submodule directories are filtered out of this list — their
   * internal diffs live under `submodules[]` instead.
   */
  patches: GitWorkingTreePatch[];
  /**
   * One group per dirty submodule (pointer bumped, content changed, or both).
   * Undefined when the parent has no submodules with pending changes.
   */
  submodules?: SubmoduleWorkingTreePatches[];
}

export interface GetGitBranchDiffPayload {
  /**
   * Override the comparison base. When omitted, the resolver uses
   * `refs/remotes/origin/HEAD`.
   */
  baseRef?: string;
  path: string;
}

export interface GitBranchDiffPatches {
  /**
   * Resolved base ref the diff was taken against (e.g. `origin/canary`).
   * Undefined when no remote default branch could be resolved.
   */
  baseRef?: string;
  /** Current branch short name, or short SHA when HEAD is detached. */
  headRef?: string;
  /** Per-file diff blocks for the parent repo, ordered added → modified → deleted. */
  patches: GitWorkingTreePatch[];
  /** One group per submodule whose pointer differs between the parent's base and HEAD. */
  submodules?: SubmoduleWorkingTreePatches[];
}

export interface GitCheckoutResult {
  error?: string;
  success: boolean;
}

export interface GitFileRevertResult {
  error?: string;
  success: boolean;
}

export interface GitRenameBranchResult {
  error?: string;
  success: boolean;
}

export interface GitDeleteBranchResult {
  error?: string;
  success: boolean;
}

export interface GitRemoveWorktreeResult {
  error?: string;
  success: boolean;
}

export interface GitAddWorktreeResult {
  error?: string;
  success: boolean;
  /** Absolute path of the created worktree, echoed back so the UI can switch to it. */
  worktreePath?: string;
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
