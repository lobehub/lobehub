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
  /**
   * Absolute path on disk — used as the `cwd` for revert / branch operations
   * the renderer fires from inside the group.
   */
  absolutePath: string;
  /** Current branch short name inside the submodule, or short SHA when detached. */
  branch?: string;
  /** True when the submodule's HEAD is detached (no branch ref). */
  detached?: boolean;
  /**
   * Display name — the submodule's directory basename. Matches what users see
   * in `.gitmodules` and in tools like WebStorm's commit grouping.
   */
  name: string;
  /**
   * Per-file diff blocks inside this submodule, same ordering as the parent's
   * `patches`. Empty when the submodule's pointer moved in the parent but the
   * submodule's own working tree is clean.
   */
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
   * Undefined when the parent has no submodules with pending changes — lets
   * the renderer keep the flat single-repo layout in that common case.
   */
  submodules?: SubmoduleWorkingTreePatches[];
}

export interface GitRemoteBranchListItem {
  /** Whether this ref is the resolved default branch (origin/HEAD target). */
  isDefault: boolean;
  /** Short ref name, e.g. `origin/canary`. */
  name: string;
}

export interface GetGitBranchDiffPayload {
  /**
   * Override the comparison base. When omitted, the controller resolves
   * `refs/remotes/origin/HEAD` and uses that.
   */
  baseRef?: string;
  path: string;
}

export interface GitBranchDiffPatches {
  /**
   * Resolved base ref the diff was taken against (e.g. `origin/canary`).
   * Undefined when no remote default branch could be resolved — in that case
   * `patches` is empty and the UI should show a `noBaseRef` empty state.
   */
  baseRef?: string;
  /**
   * Current branch short name (e.g. `fix/gateway-loading-flicker`), or short
   * SHA when HEAD is detached. Lets the UI render a GitHub-style
   * `<headRef> → <baseRef>` compare label without a second IPC round-trip.
   */
  headRef?: string;
  /**
   * Per-file diff blocks for the parent repo, ordered added → modified →
   * deleted. Submodule pointer-bump entries are filtered out and their
   * internal branch diffs live under `submodules[]` instead.
   */
  patches: GitWorkingTreePatch[];
  /**
   * One group per submodule whose pointer differs between the parent's base
   * and HEAD. Each group carries the submodule's own branch diff (its HEAD
   * vs its own origin/HEAD). Undefined when no submodules differ — lets the
   * renderer keep the flat single-repo layout in that case.
   */
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
