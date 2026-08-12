/**
 * Normalized result returned by the service layer.
 * Each ComputerRuntime subclass maps its raw service response into this shape.
 */
export interface ServiceResult {
  error?: { message: string; name?: string };
  result: any;
  success: boolean;
}

// ==================== Params ====================

export interface ListFilesParams {
  /** Working directory a relative `directoryPath` resolves against on the service side. */
  cwd?: string;
  directoryPath: string;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
}

export interface ReadFileParams {
  /** Working directory a relative `path` resolves against on the service side. */
  cwd?: string;
  endLine?: number;
  path: string;
  startLine?: number;
}

export interface WriteFileParams {
  content: string;
  createDirectories?: boolean;
  /** Working directory a relative `path` resolves against on the service side. */
  cwd?: string;
  path: string;
}

export interface EditFileParams {
  all?: boolean;
  /** Working directory a relative `path` resolves against on the service side. */
  cwd?: string;
  path: string;
  replace: string;
  search: string;
}

export interface SearchFilesParams {
  contentContains?: string;
  createdAfter?: string;
  createdBefore?: string;
  detailed?: boolean;
  directory?: string;
  exclude?: string[];
  /** @deprecated Prefer `fileTypes` (plural). Retained for cloud sandbox back-compat. */
  fileType?: string;
  fileTypes?: string[];
  /** @deprecated Prefer `keywords` (plural). Retained for cloud sandbox back-compat. */
  keyword?: string;
  keywords?: string;
  limit?: number;
  liveUpdate?: boolean;
  modifiedAfter?: string;
  modifiedBefore?: string;
  scope?: string;
  sortBy?: 'name' | 'date' | 'size';
  sortDirection?: 'asc' | 'desc';
}

export interface MoveFilesParams {
  /** Working directory each operation's relative paths resolve against on the service side. */
  cwd?: string;
  operations: Array<{
    destination: string;
    source: string;
  }>;
}

export interface RenameFileParams {
  newName: string;
  oldPath: string;
}

export interface GlobFilesParams {
  directory?: string;
  limit?: number;
  pattern: string;
}

export interface RunCommandParams {
  background?: boolean;
  command: string;
  /**
   * Working directory the shell spawns in. Without it the service falls back to
   * its own process cwd (the app install directory in a packaged desktop app).
   */
  cwd?: string;
  description?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface GetCommandOutputParams {
  commandId: string;
  /** Regex filter applied to the returned output lines. */
  filter?: string;
  /**
   * Max time to wait for this observation before returning (does not kill the
   * process). Forwarded to the service so callers polling a running command can
   * honor a per-call/gateway budget instead of the service's default wait.
   */
  timeout?: number;
}

export interface KillCommandParams {
  commandId: string;
}

/**
 * Grep params mirror the tool manifest / IPC contract (`local-file-shell`'s
 * `GrepContentParams`): the full flag set must survive to the service layer so
 * the underlying rg/grep honors the agent's filters. `ComputerRuntime` itself
 * only reads `pattern`; everything else is forwarded verbatim.
 */
export interface GrepContentParams {
  '-A'?: number;
  '-B'?: number;
  '-C'?: number;
  '-i'?: boolean;
  '-n'?: boolean;
  /** Legacy alias for the search root. Prefer `path`/`scope`. */
  'cwd'?: string;
  /** @deprecated Legacy alias for the search root. Prefer `path`/`scope`. */
  'directory'?: string;
  /** @deprecated Legacy alias for `glob`. */
  'filePattern'?: string;
  /** ripgrep-style glob filter on file paths. */
  'glob'?: string;
  'head_limit'?: number;
  'multiline'?: boolean;
  'output_mode'?: 'content' | 'count' | 'files_with_matches';
  /** Absolute search root. Takes precedence over `scope` on the service side. */
  'path'?: string;
  'pattern': string;
  'recursive'?: boolean;
  /** Working directory scope limiting the search. */
  'scope'?: string;
  /** Preferred search tool. */
  'tool'?: 'ag' | 'grep' | 'rg';
  'type'?: string;
}

// ==================== State ====================

export interface ListFilesState {
  files: Array<{
    isDirectory: boolean;
    name: string;
    path?: string;
    size?: number;
  }>;
  totalCount?: number;
}

/**
 * An image produced by a tool result — always an already-uploaded reference
 * (the producer uploads to file storage before emitting; raw base64 must
 * never reach the DB). Same shape as the hetero
 * `HeterogeneousToolResultImage` post-upload.
 */
export interface ToolResultImage {
  /** File record id in the file store. */
  fileId?: string;
  /** MIME type, e.g. `image/png`. */
  mediaType: string;
  /** Durable, fetchable URL. */
  url: string;
}

export interface ReadFileState {
  /** Character count of the returned content */
  charCount?: number;
  content: string;
  endLine?: number;
  /** Base filename extracted from path */
  filename?: string;
  /** Detected file type (e.g., 'ts', 'md', 'json') */
  fileType?: string;
  /**
   * Images produced by reading an image file. Carried in `pluginState.images`
   * on the tool message; the MessageContent tool-message processor turns each
   * into an `image_url` part so vision-capable models can actually inspect the
   * file the agent read. Empty/absent for text files.
   */
  images?: ToolResultImage[];
  /** Line range as tuple [start, end] */
  loc?: [number, number];
  path: string;
  startLine?: number;
  /** Total character count of the entire file */
  totalCharCount?: number;
  /** Total line count of the entire file */
  totalLines?: number;
}

export interface WriteFileState {
  bytesWritten?: number;
  path: string;
  success: boolean;
}

export interface EditFileState {
  diffText?: string;
  linesAdded?: number;
  linesDeleted?: number;
  path: string;
  replacements: number;
}

export interface SearchFilesState {
  results: Array<{
    isDirectory?: boolean;
    modifiedAt?: string;
    name?: string;
    path: string;
    size?: number;
  }>;
  totalCount: number;
}

export interface MoveFilesState {
  results: Array<{
    destination?: string;
    error?: string;
    source?: string;
    success: boolean;
  }>;
  successCount: number;
  totalCount: number;
}

export interface RenameFileState {
  error?: string;
  newPath: string;
  oldPath: string;
  success: boolean;
}

export interface GlobFilesState {
  files: string[];
  pattern: string;
  totalCount: number;
}

export interface RunCommandState {
  commandId?: string;
  error?: string;
  exitCode?: number;
  isBackground: boolean;
  output?: string;
  outputFiles?: {
    stderr: { path: string; size: number; truncated: boolean };
    stdout: { path: string; size: number; truncated: boolean };
  };
  /**
   * Whether the device sandbox actually confined this command.
   *
   * The execution-environment chip states the user's *intent*; this states the
   * outcome. They can differ — a run routed somewhere the sandbox flag never
   * reached executes unfenced while the chip still reads "Local sandbox" — and
   * a security property nobody can observe is one nobody should trust.
   * Undefined when no sandbox was requested.
   */
  sandboxed?: boolean;
  stderr?: string;
  stdout?: string;
  success: boolean;
}

export interface GetCommandOutputState {
  durationMs?: number;
  error?: string;
  exitCode?: number;
  outputFiles?: {
    stderr: { path: string; size: number; truncated: boolean };
    stdout: { path: string; size: number; truncated: boolean };
  };
  running?: boolean;
  stderr?: string;
  stdout?: string;
  success: boolean;
}

export interface KillCommandState {
  commandId: string;
  error?: string;
  success: boolean;
}

export interface GrepContentState {
  matches: Array<string | { content?: string; lineNumber?: number; path: string }>;
  pattern: string;
  totalMatches: number;
}
