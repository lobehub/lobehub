// ─── Shell Types ───

export interface RunCommandParams {
  command: string;
  cwd?: string;
  description?: string;
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
}

export interface GetCommandOutputResult {
  error?: string;
  output: string;
  running: boolean;
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

// ─── File Types ───

export interface ReadFileParams {
  fullContent?: boolean;
  loc?: [number, number];
  path: string;
}

export interface ReadFileResult {
  charCount: number;
  content: string;
  createdTime: Date;
  filename: string;
  fileType: string;
  lineCount: number;
  /** Number of returned lines truncated because they exceeded the per-line character cap. */
  linesTruncated?: number;
  loc: [number, number];
  modifiedTime: Date;
  totalCharCount: number;
  totalLineCount: number;
  /** True when the returned content was truncated because it exceeded the total character cap. */
  truncated?: boolean;
}

export interface WriteFileParams {
  content: string;
  path: string;
}

export interface WriteFileResult {
  error?: string;
  success: boolean;
}

export interface EditFileParams {
  file_path: string;
  new_string: string;
  old_string: string;
  replace_all?: boolean;
}

export interface EditFileResult {
  diffText?: string;
  error?: string;
  linesAdded?: number;
  linesDeleted?: number;
  replacements: number;
  success: boolean;
}

export interface ListFilesParams {
  limit?: number;
  path: string;
  sortBy?: 'createdTime' | 'modifiedTime' | 'name' | 'size';
  sortOrder?: 'asc' | 'desc';
}

export interface FileEntry {
  createdTime: Date;
  isDirectory: boolean;
  lastAccessTime: Date;
  modifiedTime: Date;
  name: string;
  path: string;
  size: number;
  type: string;
}

export interface ListFilesResult {
  files: FileEntry[];
  totalCount: number;
}

export interface GlobFilesParams {
  /** Legacy alias for `scope`. Honored when set; prefer `scope` for new callers. */
  cwd?: string;
  pattern: string;
  /** Working directory scope. When `pattern` is relative, it is joined with this scope. Defaults to the current working directory. */
  scope?: string;
}

export interface GlobFilesResult {
  /** Search engine used: 'fd' | 'find' | 'fast-glob' */
  engine?: string;
  error?: string;
  files: string[];
  /** Diagnostic note returned when the engine had to adjust behavior, e.g. auto-enabling hidden-file matching. */
  hint?: string;
  success: boolean;
  total_files: number;
}

export interface FileResult {
  contentType?: string;
  createdTime: Date;
  /** Search engine used to find this file (e.g. 'mdfind', 'fd', 'find', 'fast-glob'). */
  engine?: string;
  isDirectory: boolean;
  lastAccessTime: Date;
  /** Engine-specific metadata (e.g. Spotlight attributes). */
  metadata?: Record<string, unknown>;
  modifiedTime: Date;
  name: string;
  path: string;
  size: number;
  type: string;
}

export interface SearchFilesParams {
  contentContains?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  detailed?: boolean;
  /** Legacy alias for `onlyIn`. */
  directory?: string;
  exclude?: string[];
  fileTypes?: string[];
  keywords: string;
  limit?: number;
  liveUpdate?: boolean;
  modifiedAfter?: Date;
  modifiedBefore?: Date;
  onlyIn?: string;
  sortBy?: 'date' | 'name' | 'size';
  sortDirection?: 'asc' | 'desc';
}

/**
 * Lightweight search result for the thin wrapper API ({@link searchLocalFiles}).
 * The factory-based API ({@link createFileSearchModule}) returns the richer
 * {@link FileResult} instead.
 */
export interface SearchFilesResult {
  createdTime?: Date;
  isDirectory?: boolean;
  lastAccessTime?: Date;
  modifiedTime?: Date;
  name: string;
  path: string;
  size?: number;
  type?: string;
}

/** Alias for {@link SearchFilesParams} kept for the legacy `SearchOptions` import path. */
export type SearchOptions = SearchFilesParams;

export interface MoveFileItem {
  newPath: string;
  oldPath: string;
}

export interface MoveFilesParams {
  items: MoveFileItem[];
}

export interface MoveFileResultItem {
  error?: string;
  newPath?: string;
  sourcePath: string;
  success: boolean;
}

export interface RenameFileParams {
  newName: string;
  path: string;
}

export interface RenameFileResult {
  error?: string;
  newPath: string;
  success: boolean;
}

export interface GrepContentParams {
  '-A'?: number;
  '-B'?: number;
  '-C'?: number;
  '-i'?: boolean;
  '-n'?: boolean;
  /** Legacy alias for `scope`. */
  'cwd'?: string;
  /** Legacy alias for `glob`. Set this for the simple wrapper API. */
  'filePattern'?: string;
  /** ripgrep-style glob filter on file paths. */
  'glob'?: string;
  'head_limit'?: number;
  'multiline'?: boolean;
  'output_mode'?: 'content' | 'count' | 'files_with_matches';
  /** Legacy alias for `scope`. Takes precedence when set; prefer `scope`. */
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
  /** Diagnostic note returned when the engine had to adjust behavior, e.g. auto-enabling hidden-file matching. */
  hint?: string;
  /**
   * Match payload. For the simple wrapper API this is the raw rg --json
   * objects; for the factory-based API it's an array of string lines whose
   * format depends on `output_mode`.
   */
  matches: any[];
  success: boolean;
  total_matches: number;
}
