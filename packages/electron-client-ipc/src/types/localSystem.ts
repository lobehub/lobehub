// Define types for local file operations
export interface LocalFileItem {
  contentType?: string;
  createdTime: Date;
  /** Search engine used to find this file (e.g., 'mdfind', 'fd', 'find', 'fast-glob') */
  engine?: string;
  isDirectory: boolean;
  lastAccessTime: Date;
  // Spotlight specific metadata
  metadata?: {
    [key: string]: any;
  };
  modifiedTime: Date;
  name: string;
  path: string;
  size: number;
  type: string;
}

export type ListLocalFileSortBy = 'name' | 'modifiedTime' | 'createdTime' | 'size';
export type ListLocalFileSortOrder = 'asc' | 'desc';

export interface ListLocalFileParams {
  /**
   * Working directory a relative `path` resolves against (the device-bound
   * directory, injected by the server runtime — not model-supplied). Absolute
   * paths ignore it; absent → the daemon's process cwd.
   */
  cwd?: string;
  /**
   * Maximum number of files to return
   * @default 100
   */
  limit?: number;
  /**
   * Directory path to list
   */
  path: string;
  /**
   * Field to sort by
   * @default 'modifiedTime'
   */
  sortBy?: ListLocalFileSortBy;
  /**
   * Sort order
   * @default 'desc'
   */
  sortOrder?: ListLocalFileSortOrder;
}

export interface ListLocalFilesResult {
  /**
   * List of files (truncated to limit)
   */
  files: LocalFileItem[];
  /**
   * Total count of files before truncation
   */
  totalCount: number;
}

export interface MoveLocalFileParams {
  newPath: string;
  oldPath: string;
}

export interface MoveLocalFilesParams {
  /** Working directory each item's relative paths resolve against. See {@link ListLocalFileParams.cwd}. */
  cwd?: string;
  items: MoveLocalFileParams[];
}

export interface LocalMoveFilesResultItem {
  error?: string; // Error message if this specific item failed
  newPath?: string; // The final path after moving/renaming, if successful
  sourcePath: string; // The original path of the item being moved/renamed
  success: boolean; // Whether the operation for this specific item was successful
}

export interface RenameLocalFileParams {
  newName: string;
  path: string;
}

export interface RenameLocalFileResult {
  error?: any;
  newPath: string;
  success: boolean;
}

export interface LocalReadFileParams {
  /** Working directory a relative `path` resolves against. See {@link ListLocalFileParams.cwd}. */
  cwd?: string;
  fullContent?: boolean;
  loc?: [number, number];
  path: string;
}

export interface LocalReadFilesParams {
  /** Working directory each relative path resolves against. See {@link ListLocalFileParams.cwd}. */
  cwd?: string;
  paths: string[];
}

export interface WriteLocalFileParams {
  /**
   * Content to write
   */
  content: string;
  /** Working directory a relative `path` resolves against. See {@link ListLocalFileParams.cwd}. */
  cwd?: string;

  /**
   * File path to write to
   */
  path: string;
}

export interface AuditSafePathsParams {
  paths: string[];
  resolveAgainstScope: string;
}

export interface AuditSafePathsResult {
  allSafe: boolean;
}

export type LocalFilePreviewAccept = 'image';

export interface LocalFilePreviewUrlParams {
  accept?: LocalFilePreviewAccept;
  /**
   * Allows previewing one user-selected file outside approved workspace roots.
   * This is only for renderer previews and must not expand agent file access.
   */
  allowExternalFile?: boolean;
  path: string;
  workingDirectory: string;
}

export interface LocalFilePreviewUrlResult {
  error?: string;
  success: boolean;
  url?: string;
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
  | LocalFilePreviewImage
  | LocalFilePreviewText
  | LocalFilePreviewUnsupported;

export interface LocalFilePreviewResult {
  error?: string;
  preview?: LocalFilePreview;
  success: boolean;
}

export interface LocalReadFileResult {
  /**
   * Character count of the content within the specified `loc` range.
   */
  charCount: number;
  /**
   * Content of the file within the specified `loc` range.
   */
  content: string;
  createdTime: Date;
  filename: string;
  fileType: string;
  /**
   * Line count of the content within the specified `loc` range.
   */
  lineCount: number;
  loc: [number, number];
  modifiedTime: Date;
  /**
   * Total character count of the entire file.
   */
  totalCharCount: number;
  /**
   * Total line count of the entire file.
   */
  totalLineCount: number;
}

export interface LocalSearchFilesParams {
  // Content options
  contentContains?: string; // Search for files containing specific text

  // Time options (ISO 8601 date strings)
  createdAfter?: string;
  createdBefore?: string;

  // Result options
  detailed?: boolean;

  // Path options
  directory?: string; // Limit search to specific directory

  exclude?: string[]; // Paths to exclude from search
  // File type options
  fileTypes?: string[]; // File extensions to filter (e.g., ['pdf', 'docx'])
  // Basic search
  keywords: string;
  limit?: number;

  liveUpdate?: boolean;
  modifiedAfter?: string;
  modifiedBefore?: string;

  /** Working directory scope. When `directory` is not specified, used as the default search location. */
  scope?: string;
  sortBy?: 'name' | 'date' | 'size';
  sortDirection?: 'asc' | 'desc';
}

export interface ProjectFileIndexEntry {
  isDirectory: boolean;
  name: string;
  path: string;
  relativePath: string;
}

export interface ProjectFileIndexParams {
  /** Working directory used to resolve the project root. Defaults to Electron process cwd. */
  scope?: string;
}

export interface ProjectFileIndexResult {
  entries: ProjectFileIndexEntry[];
  indexedAt: string;
  root: string;
  source: 'git' | 'glob';
  totalCount: number;
}

export interface OpenLocalFileParams {
  path: string;
}

export interface OpenLocalFolderParams {
  isDirectory?: boolean;
  path: string;
}

// Shell command types
export interface RunCommandParams {
  command: string;
  cwd?: string;
  description?: string;
  /** Merged into the child process environment (after `process.env`). */
  env?: Record<string, string>;
  run_in_background?: boolean;
  timeout?: number;
}

export interface RunCommandResult {
  error?: string;
  exit_code?: number;
  output?: string;
  shell_id?: string;
  stderr?: string;
  stdout?: string;
  success: boolean;
}

export interface GetCommandOutputParams {
  filter?: string;
  shell_id: string;
  /**
   * Maximum time to wait for this observation before returning.
   * Does not kill the process when the timeout elapses.
   */
  timeout?: number;
}

export interface GetCommandOutputResult {
  error?: string;
  /**
   * Present only after the command has exited.
   * `0` means success, non-zero means the command finished with an error.
   * `undefined` means the command is still running.
   */
  exit_code?: number;
  output: string;
  stderr: string;
  stdout: string;
  success: boolean;
}

export interface KillCommandParams {
  shell_id: string;
}

export interface KillCommandResult {
  error?: string;
  success: boolean;
}

// Grep types — declared locally to keep this package leaf-only (no reverse
// dependency on `@lobechat/local-file-shell`). The shape mirrors the
// definition in `local-file-shell/types`; the two must stay in sync, but
// they're structurally compatible by design.
export interface GrepContentParams {
  '-A'?: number;
  '-B'?: number;
  '-C'?: number;
  '-i'?: boolean;
  '-n'?: boolean;
  'glob'?: string;
  'head_limit'?: number;
  'multiline'?: boolean;
  'output_mode'?: 'content' | 'count' | 'files_with_matches';
  /** Legacy alias for `scope`. Takes precedence when set; prefer `scope` (the manifest-documented name) for new callers. */
  'path'?: string;
  'pattern': string;
  /** Working directory scope. Limits the search to this directory. Defaults to `process.cwd()`. */
  'scope'?: string;
  /** Preferred search tool: 'rg' | 'ag' | 'grep' */
  'tool'?: 'ag' | 'grep' | 'rg';
  'type'?: string;
}

export interface GrepContentResult {
  /** Search engine used: 'rg' | 'ag' | 'grep' | 'nodejs' */
  engine?: string;
  error?: string;
  matches: string[];
  success: boolean;
  total_matches: number;
}

// Glob types — same rationale as Grep above.
export interface GlobFilesParams {
  pattern: string;
  /** Working directory scope. When `pattern` is relative, it is joined with this scope. Defaults to the current working directory. */
  scope?: string;
}

export interface GlobFilesResult {
  /** Search engine used: 'fd' | 'find' | 'fast-glob' */
  engine?: string;
  error?: string;
  files: string[];
  success: boolean;
  total_files: number;
}

// Edit types
export interface EditLocalFileParams {
  /** Working directory a relative `file_path` resolves against. See {@link ListLocalFileParams.cwd}. */
  cwd?: string;
  file_path: string;
  new_string: string;
  old_string: string;
  replace_all?: boolean;
}

export interface EditLocalFileResult {
  diffText?: string;
  error?: string;
  linesAdded?: number;
  linesDeleted?: number;
  replacements: number;
  success: boolean;
}

// Open Dialog types
export interface ShowOpenDialogParams {
  /**
   * File type filters
   */
  filters?: { extensions: string[]; name: string }[];
  /**
   * Allow selecting multiple files
   */
  multiple?: boolean;
  /**
   * Dialog title
   */
  title?: string;
}

export interface ShowOpenDialogResult {
  /**
   * Whether the dialog was cancelled
   */
  canceled: boolean;
  /**
   * The selected file paths (empty if cancelled)
   */
  filePaths: string[];
}

// Pick File (dialog + read in one IPC call)
export interface PickFileParams {
  filters?: { extensions: string[]; name: string }[];
  title?: string;
}

export interface PickFileResult {
  canceled: boolean;
  file?: {
    data: Uint8Array;
    mimeType: string;
    name: string;
  };
}

// Save Dialog types
export interface ShowSaveDialogParams {
  /**
   * Default file name
   */
  defaultPath?: string;
  /**
   * File type filters
   */
  filters?: { extensions: string[]; name: string }[];
  /**
   * Dialog title
   */
  title?: string;
}

export interface ShowSaveDialogResult {
  /**
   * Whether the dialog was cancelled
   */
  canceled: boolean;
  /**
   * The selected file path (undefined if cancelled)
   */
  filePath?: string;
}

export interface PrepareSkillDirectoryParams {
  forceRefresh?: boolean;
  url: string;
  zipHash: string;
}

export interface PrepareSkillDirectoryResult {
  error?: string;
  extractedDir: string;
  success: boolean;
  zipPath: string;
}

export interface ResolveSkillResourcePathParams {
  path: string;
  url: string;
  zipHash: string;
}

export interface ResolveSkillResourcePathResult {
  error?: string;
  fullPath?: string;
  success: boolean;
}

export interface ProjectSkillItem {
  description?: string;
  /** Total number of regular files under `skillDir` (recursive, including `SKILL.md`). */
  fileCount: number;
  /**
   * Relative paths (within `skillDir`) of all regular files under the skill,
   * sorted lexicographically and capped to a safe maximum. Includes `SKILL.md`.
   */
  files: string[];
  name: string;
  /** Absolute path to the SKILL.md file. */
  path: string;
  /** Directory containing the SKILL.md (e.g. `<root>/.agents/skills/spa-routes`). */
  skillDir: string;
  /** Source directory the skill was discovered in. */
  source: '.agents/skills' | '.claude/skills';
}

export interface ListProjectSkillsParams {
  /** Working directory used to resolve the project root. */
  scope: string;
}

export interface ListProjectSkillsResult {
  root: string;
  skills: ProjectSkillItem[];
  /** Source directory actually scanned (after fallback resolution). */
  source: ProjectSkillItem['source'] | null;
}

export interface InitWorkspaceParams {
  /** Working directory used to resolve the project root. */
  scope: string;
}

/**
 * Project-root agent instructions (`AGENTS.md` / `CLAUDE.md`) read in one shot
 * during workspace init. Full body is carried (capped) so the server can inject
 * it into the system role and the web UI can render it without a second call.
 * Mirrors `WorkspaceInstructions` in `@lobechat/types` (kept local — this is a
 * leaf package with no `@lobechat/types` dependency).
 */
export interface WorkspaceInstructionsItem {
  content: string;
  source: 'AGENTS.md' | 'CLAUDE.md';
}

/**
 * One-call workspace scan: project-root instructions + project skills (both
 * `.agents/skills` and `.claude/skills`, merged). Mirrors `WorkspaceInitResult`
 * in `@lobechat/types`; the server narrows `skills` to `ProjectSkillMeta` when
 * caching onto `devices.workingDirs[].workspace`.
 */
export interface InitWorkspaceResult {
  instructions: WorkspaceInstructionsItem[];
  root: string;
  skills: ProjectSkillItem[];
}
