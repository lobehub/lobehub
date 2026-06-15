/**
 * A project-level skill discovered on the device filesystem
 * (`.agents/skills` / `.claude/skills`) by the client at request time.
 * Only frontmatter + the absolute SKILL.md path are carried; the SKILL.md
 * body and directory tree are loaded on demand at activation time via the
 * readFile / listFiles tools.
 */
export interface ProjectSkillMeta {
  /** Skill description from SKILL.md frontmatter. */
  description?: string;
  /** Skill name from frontmatter (falls back to the directory name). */
  name: string;
  /** Absolute path to the skill's SKILL.md on the device filesystem. */
  path: string;
}

/**
 * A single project-root agent instructions file (`AGENTS.md` / `CLAUDE.md`) read
 * from the device filesystem during workspace init. Unlike skills (metadata
 * only), the full body is carried so it can be injected into the system role and
 * rendered in web without a second device round-trip. Carried as a list on
 * {@link WorkspaceInitResult} since multiple files can coexist (e.g. both
 * `AGENTS.md` and `CLAUDE.md`, or future nested files).
 */
export interface WorkspaceInstructions {
  /** Full file content (capped at read time, e.g. 64KB). */
  content: string;
  /** Source file the instructions were read from. */
  source: 'AGENTS.md' | 'CLAUDE.md';
}

/**
 * Result of scanning a bound project directory ("workspace init"): the agent
 * instructions file plus the project-level skills discovered under
 * `.agents/skills` + `.claude/skills`. Produced in a single device round-trip
 * (`deviceGateway.initWorkspace`) and cached on `devices.workingDirs[].workspace`
 * so subsequent runs within the TTL — and the web UI — reuse it without
 * re-scanning. Intentionally open to growth (env info, git status, …) as more
 * environment-preparation logic lands.
 *
 * The scanned root is not stored here — it is always the enclosing
 * `WorkingDirEntry.path`.
 */
export interface WorkspaceInitResult {
  /**
   * Project-root agent instructions files (`AGENTS.md` / `CLAUDE.md`). Empty
   * when none are present.
   */
  instructions: WorkspaceInstructions[];
  /** Project-level skills discovered under the project root (metadata only). */
  skills: ProjectSkillMeta[];
}

/**
 * A working directory a device has used. Structured (rather than a bare path
 * string) so metadata such as the detected repo type survives — a remote client
 * viewing this device can't re-probe its filesystem, so whatever isn't captured
 * here at the source is lost. Mirrors the client-local `RecentDirEntry` shape.
 */
export interface WorkingDirEntry {
  path: string;
  repoType?: 'git' | 'github';
  /**
   * Cached "workspace init" scan of this directory (AGENTS.md + project skills).
   * Populated server-side at run start via `deviceGateway.initWorkspace` and
   * reused within the TTL gated by `workspaceScannedAt`. Also read directly by
   * the web UI to render the project's skills / instructions.
   */
  workspace?: WorkspaceInitResult;
  /**
   * Epoch ms when `workspace` was last scanned. Hoisted to the top level (out of
   * `workspace`) so freshness can be checked without deserializing the payload.
   */
  workspaceScannedAt?: number;
}

/** A single live gateway WebSocket connection belonging to a device. */
export interface DeviceChannel {
  channel: string | null;
  connectedAt: string;
  hostname: string | null;
  platform: string | null;
}

/**
 * A device row as returned by the `device.listDevices` query — either a
 * registered device or an online-only "ghost" (connected but not yet persisted).
 * The server query is annotated to return `DeviceListItem[]`, so this type is the
 * contract rather than something inferred from the router.
 */
export interface DeviceListItem {
  channels: DeviceChannel[];
  defaultCwd: string | null;
  deviceId: string;
  friendlyName: string | null;
  hostname: string | null;
  identitySource: string | null;
  lastSeen: string;
  online: boolean;
  platform: string | null;
  registered: boolean;
  workingDirs: WorkingDirEntry[];
}

/**
 * Branch name + detached-HEAD flag for a working directory, returned by the
 * `getGitBranch` device RPC. Mirrors the desktop `GitBranchInfo`.
 */
export interface DeviceGitBranchInfo {
  /** Branch short name, or short SHA when in detached HEAD state. */
  branch?: string;
  /** True when HEAD is detached (no branch ref). */
  detached?: boolean;
}

/** A GitHub pull request linked to a branch. */
export interface DeviceGitLinkedPullRequest {
  number: number;
  state: string;
  title: string;
  url: string;
}

/**
 * Result of the `getLinkedPullRequest` device RPC: the PR linked to a branch
 * (when the repo is a GitHub remote). Mirrors the desktop shape.
 */
export interface DeviceGitLinkedPullRequestResult {
  /** Additional open PRs targeting the same head branch, beyond the primary one. */
  extraCount?: number;
  /** Null when no open PR is linked to the branch. */
  pullRequest: DeviceGitLinkedPullRequest | null;
  /** 'ok' — lookup succeeded; 'gh-missing' — gh CLI unavailable; 'error' — other failure. */
  status: 'error' | 'gh-missing' | 'ok';
}

/**
 * Working-tree dirty-file counts for a working directory, returned by the
 * `getGitWorkingTreeStatus` device RPC. Mirrors the desktop shape.
 */
export interface DeviceGitWorkingTreeStatus {
  added: number;
  clean: boolean;
  deleted: number;
  modified: number;
  total: number;
}

/**
 * One git worktree attached to a repository, returned by the `listGitWorktrees`
 * device RPC. Mirrors the desktop `GitWorktreeListItem`.
 */
export interface DeviceGitWorktreeListItem {
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
  status?: DeviceGitWorkingTreeStatus;
}

/**
 * Commit divergence vs the upstream tracking ref, returned by the
 * `getGitAheadBehind` device RPC. Mirrors the desktop shape.
 */
export interface DeviceGitAheadBehind {
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  pushTarget?: string;
  pushTargetExists?: boolean;
  upstream?: string;
}

/**
 * One local branch on a device's working directory, returned by the
 * `listGitBranches` device RPC. Mirrors the desktop `GitBranchListItem` so the
 * branch switcher consumes the IPC and RPC paths interchangeably.
 */
export interface DeviceGitBranchListItem {
  current: boolean;
  name: string;
  upstream?: string;
}

/** Result of the `checkoutGitBranch` device RPC. Mirrors the desktop shape. */
export interface DeviceGitCheckoutResult {
  error?: string;
  success: boolean;
}

/**
 * Result of the `pullGitBranch` / `pushGitBranch` device RPCs. Mirrors the
 * desktop `GitPullResult` / `GitPushResult` (identical shapes).
 */
export interface DeviceGitSyncResult {
  error?: string;
  /** True when git reported the branch was already up-to-date. */
  noop?: boolean;
  success: boolean;
}

/**
 * One per-file diff block in a working-tree / branch diff. Mirrors the desktop
 * `GitWorkingTreePatch` — shared by both the unstaged and branch-diff RPCs.
 */
export interface DeviceGitWorkingTreePatch {
  /** Number of `+` lines in the patch. */
  additions: number;
  /** Number of `-` lines in the patch. */
  deletions: number;
  /** Repo-relative path of the file. */
  filePath: string;
  /** True when git reported `Binary files … differ` for this entry. */
  isBinary: boolean;
  /** Unified diff text. Empty when binary or truncated. */
  patch: string;
  /** Diff bucket. */
  status: 'added' | 'modified' | 'deleted';
  /** Patch elided because it exceeded the per-file size cap. */
  truncated: boolean;
}

/**
 * Patches collected from a dirty submodule. Mirrors the desktop
 * `SubmoduleWorkingTreePatches`; composes {@link DeviceGitWorkingTreePatch}.
 */
export interface DeviceSubmoduleWorkingTreePatches {
  /** Absolute path on disk — used as the `cwd` for per-submodule ops. */
  absolutePath: string;
  /** Current branch short name inside the submodule, or short SHA when detached. */
  branch?: string;
  /** True when the submodule's HEAD is detached. */
  detached?: boolean;
  /** Display name — the submodule's directory basename. */
  name: string;
  /** Per-file diff blocks inside this submodule. */
  patches: DeviceGitWorkingTreePatch[];
  /** Path relative to the parent repo root. */
  relativePath: string;
}

/**
 * Result of the `getGitWorkingTreePatches` device RPC. Mirrors the desktop
 * `GitWorkingTreePatches`.
 */
export interface DeviceGitWorkingTreePatches {
  /** All dirty file patches in the parent repo. */
  patches: DeviceGitWorkingTreePatch[];
  /** One group per dirty submodule. Undefined when none. */
  submodules?: DeviceSubmoduleWorkingTreePatches[];
}

/**
 * Result of the `getGitBranchDiff` device RPC. Mirrors the desktop
 * `GitBranchDiffPatches`.
 */
export interface DeviceGitBranchDiffPatches {
  /** Resolved base ref the diff was taken against. Undefined when unresolved. */
  baseRef?: string;
  /** Current branch short name, or short SHA when detached. */
  headRef?: string;
  /** Per-file diff blocks for the parent repo. */
  patches: DeviceGitWorkingTreePatch[];
  /** One group per submodule whose pointer differs. Undefined when none. */
  submodules?: DeviceSubmoduleWorkingTreePatches[];
}

/**
 * One remote branch under `refs/remotes/origin/*`, returned by the
 * `listGitRemoteBranches` device RPC. Mirrors the desktop `GitRemoteBranchListItem`.
 */
export interface DeviceGitRemoteBranchListItem {
  /** Whether this ref is the resolved default branch (origin/HEAD target). */
  isDefault: boolean;
  /** Short ref name, e.g. `origin/canary`. */
  name: string;
}

/** Result of the `revertGitFile` device RPC. Mirrors the desktop `GitFileRevertResult`. */
export interface DeviceGitFileRevertResult {
  error?: string;
  success: boolean;
}

/** Result of the `renameGitBranch` device RPC. Mirrors the desktop `GitRenameBranchResult`. */
export interface DeviceGitRenameBranchResult {
  error?: string;
  success: boolean;
}

/** Result of the `deleteGitBranch` device RPC. Mirrors the desktop `GitDeleteBranchResult`. */
export interface DeviceGitDeleteBranchResult {
  error?: string;
  success: boolean;
}

/**
 * Repo-relative paths of dirty working-tree files for a directory on a remote
 * device, returned by the `getGitWorkingTreeFiles` device RPC. Powers the Files
 * tab's git-status overlay. Mirrors the desktop `GitWorkingTreeFiles`.
 */
export interface DeviceGitWorkingTreeFiles {
  added: string[];
  deleted: string[];
  modified: string[];
}

/** One entry in a device's project file index. Mirrors `ProjectFileIndexEntry`. */
export interface DeviceProjectFileIndexEntry {
  isDirectory: boolean;
  name: string;
  /** Absolute path on the device filesystem. */
  path: string;
  /** Path relative to the project root; directories end with `/`. */
  relativePath: string;
}

/**
 * Project file index (tree) for a directory on a remote device, returned by the
 * `getProjectFileIndex` device RPC. Powers the Files tab's tree. Mirrors the
 * desktop `ProjectFileIndexResult`.
 */
export interface DeviceProjectFileIndexResult {
  entries: DeviceProjectFileIndexEntry[];
  indexedAt: string;
  root: string;
  source: 'git' | 'glob';
  totalCount: number;
}

export interface DeviceLocalFilePreviewText {
  content: string;
  contentType: string;
  type: 'text';
}

export interface DeviceLocalFilePreviewImage {
  base64: string;
  contentType: string;
  type: 'image';
}

export interface DeviceLocalFilePreviewUnsupported {
  contentType: string;
  type: 'binary' | 'pdf' | 'video';
}

export type DeviceLocalFilePreview =
  | DeviceLocalFilePreviewImage
  | DeviceLocalFilePreviewText
  | DeviceLocalFilePreviewUnsupported;

/**
 * File preview payload for a file on a remote device. Mirrors the desktop local
 * file preview result but carries binary image content as base64 so it can cross
 * the Gateway/RPC boundary.
 */
export interface DeviceLocalFilePreviewResult {
  error?: string;
  preview?: DeviceLocalFilePreview;
  success: boolean;
}

/** One file/folder to move within a directory on a remote device. Mirrors `MoveLocalFileParams`. */
export interface DeviceMoveProjectFileItem {
  newPath: string;
  oldPath: string;
}

/**
 * Per-item result of the `moveLocalFiles` device RPC. The move is batched and
 * each item succeeds or fails independently. Mirrors the desktop
 * `LocalMoveFilesResultItem`.
 */
export interface DeviceMoveProjectFileResultItem {
  error?: string;
  newPath?: string;
  sourcePath: string;
  success: boolean;
}

/** Result of the `renameLocalFile` device RPC. Mirrors the desktop `RenameLocalFileResult`. */
export interface DeviceRenameProjectFileResult {
  error?: string;
  newPath: string;
  success: boolean;
}

/**
 * Result of the `writeLocalFile` device RPC — saving edited content back to a
 * file on a remote device. Mirrors the desktop `WriteFileResult`.
 */
export interface DeviceWriteProjectFileResult {
  error?: string;
  success: boolean;
}

/**
 * A single project skill (`.agents/skills` / `.claude/skills`) discovered on a
 * remote device, returned by the `listProjectSkills` device RPC. Mirrors the
 * desktop `ProjectSkillItem` (`@lobechat/electron-client-ipc`).
 */
export interface DeviceProjectSkillItem {
  description?: string;
  fileCount: number;
  files: string[];
  name: string;
  /** Absolute path to the SKILL.md file on the device. */
  path: string;
  /** Directory containing the SKILL.md. */
  skillDir: string;
  source: '.agents/skills' | '.claude/skills';
}

/**
 * Project skills listing for a directory on a remote device, returned by the
 * `listProjectSkills` device RPC. Powers the Resources tab's skills group in
 * device mode. Mirrors the desktop `ListProjectSkillsResult`.
 */
export interface DeviceListProjectSkillsResult {
  root: string;
  skills: DeviceProjectSkillItem[];
  source: DeviceProjectSkillItem['source'] | null;
}
