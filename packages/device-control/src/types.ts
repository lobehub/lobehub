/**
 * Types for the device-control RPC surface. These mirror the shapes in
 * `@lobechat/electron-client-ipc` (desktop) and `@lobechat/types` (server), but
 * are re-declared here so this package stays a leaf with no UI / server
 * dependency. They are structurally compatible with their counterparts, so the
 * desktop wiring can pass its own IPC-typed implementations directly.
 */

// ─── Workspace scan ───

export type ProjectSkillScope = 'device' | 'project';
export type ProjectSkillSource = '.agents/skills' | '.claude/skills';

export interface ProjectSkillItem {
  description?: string;
  /** Total number of regular files under `skillDir` (recursive, including `SKILL.md`). */
  fileCount: number;
  /** Relative paths (within `skillDir`) of all regular files, sorted, capped. */
  files: string[];
  name: string;
  /** Absolute path to the SKILL.md file. */
  path: string;
  /** Approved root used by the host preview protocol for this skill. */
  previewRoot: string;
  /** Skill filesystem scope: project cwd or execution-device home. */
  scope: ProjectSkillScope;
  /** Directory containing the SKILL.md. */
  skillDir: string;
  /** Source directory the skill was discovered in. */
  source: ProjectSkillSource;
}

export interface InitWorkspaceParams {
  /** Working directory used to resolve the project root. */
  scope: string;
}

export interface WorkspaceInstructionsItem {
  content: string;
  source: 'AGENTS.md' | 'CLAUDE.md';
}

export interface InitWorkspaceResult {
  instructions: WorkspaceInstructionsItem[];
  root: string;
  skills: ProjectSkillItem[];
}

export interface ListProjectSkillsParams {
  /** Working directory used to resolve the project root. */
  scope: string;
}

export interface ListProjectSkillsResult {
  root: string;
  skills: ProjectSkillItem[];
  /** Legacy source hint. Per-skill `scope` / `source` fields are authoritative. */
  source: ProjectSkillSource | null;
}

export interface StatPathResult {
  exists: boolean;
  isDirectory: boolean;
  repoType?: 'git' | 'github';
}

// ─── File preview ───

export type LocalFilePreviewAccept = 'image';

export interface LocalFilePreviewUrlParams {
  accept?: LocalFilePreviewAccept;
  path: string;
  workingDirectory: string;
}

export interface LocalFilePreviewText {
  content: string;
  contentType: string;
  type: 'text';
}

export interface LocalFilePreviewImage {
  base64: string;
  contentType: string;
  type: 'image';
}

export interface LocalFilePreviewUnsupported {
  contentType: string;
  type: 'binary' | 'pdf' | 'video';
}

export type LocalFilePreview =
  LocalFilePreviewImage | LocalFilePreviewText | LocalFilePreviewUnsupported;

export interface LocalFilePreviewResult {
  error?: string;
  preview?: LocalFilePreview;
  success: boolean;
}

// ─── Project file index ───

export interface ProjectFileIndexEntry {
  isDirectory: boolean;
  name: string;
  path: string;
  relativePath: string;
}

export interface ProjectFileIndexParams {
  /** Working directory used to resolve the project root. */
  scope?: string;
}

export interface ProjectFileIndexResult {
  entries: ProjectFileIndexEntry[];
  indexedAt: string;
  root: string;
  source: 'git' | 'glob';
}

export interface ProjectFileSearchParams extends ProjectFileIndexParams {
  limit?: number;
  query: string;
}

export interface ProjectFileSearchResult {
  entries: ProjectFileIndexEntry[];
  root: string;
  searchedAt: string;
  source: 'git' | 'glob';
}

/**
 * The subset of platform hooks the workspace-scan helpers need. Kept narrow so
 * the desktop's local-IPC `WorkspaceCtr` can reuse `initWorkspace` /
 * `listProjectSkills` without supplying the file preview / index handlers.
 */
export interface WorkspaceScanDeps {
  /**
   * Approve a resolved project root for the host's file-preview protocol. Called
   * after workspace scans so a later click-through resolves. No-op on the CLI.
   */
  approveProjectRoot?: (root: string) => Promise<void>;
}

/**
 * Platform-specific handlers the device-control dispatcher delegates to. Git and
 * workspace-scan methods are implemented inside this package (over
 * `@lobechat/local-file-shell`); the handlers below differ per host:
 *
 * - Desktop injects implementations backed by its `localFileProtocolManager`
 *   (preview-protocol approval, secure file reads).
 * - The CLI uses the portable defaults exported from this package
 *   (`defaultGetLocalFilePreview`, `defaultGetProjectFileIndex`).
 */
export interface DeviceControlDeps extends WorkspaceScanDeps {
  /** Read a local file preview (host-gated on desktop; disk read on CLI). */
  getLocalFilePreview: (params: LocalFilePreviewUrlParams) => Promise<LocalFilePreviewResult>;
  /** Build the project file index. */
  getProjectFileIndex: (params: ProjectFileIndexParams) => Promise<ProjectFileIndexResult>;
  /** Search project files without shipping the whole index to the caller. */
  searchProjectFiles: (params: ProjectFileSearchParams) => Promise<ProjectFileSearchResult>;
}
