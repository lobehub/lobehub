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
 * Git status of a device's working directory, returned by the `gitInfo` device
 * RPC so a remote device (or web client) can render branch / file changes / PR
 * the same way the local desktop does. Field shapes mirror the desktop git
 * service so the UI consumes both paths interchangeably.
 */
export interface DeviceGitInfo {
  /** Commit divergence vs the upstream tracking ref. */
  aheadBehind: {
    ahead: number;
    behind: number;
    hasUpstream: boolean;
    pushTarget?: string;
    pushTargetExists?: boolean;
    upstream?: string;
  };
  /** Branch name + linked GitHub pull request (when the repo is a GitHub remote). */
  info: {
    branch?: string;
    detached?: boolean;
    extraCount?: number;
    ghMissing?: boolean;
    pullRequest?: { number: number; state: string; title: string; url: string } | null;
  };
  /** Working-tree dirty-file counts. */
  workingStatus: {
    added: number;
    clean: boolean;
    deleted: number;
    modified: number;
    total: number;
  };
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
