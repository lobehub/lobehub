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
  directoryPath: string;
  sortBy?: string;
  sortOrder?: string;
}

export interface ReadFileParams {
  endLine?: number;
  path: string;
  startLine?: number;
}

export interface WriteFileParams {
  content: string;
  createDirectories?: boolean;
  path: string;
}

export interface EditFileParams {
  all?: boolean;
  path: string;
  replace: string;
  search: string;
}

export interface SearchFilesParams {
  directory: string;
  fileType?: string;
  keyword?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
}

export interface MoveFilesParams {
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
  pattern: string;
}

export interface RunCommandParams {
  background?: boolean;
  command: string;
  timeout?: number;
}

export interface GetCommandOutputParams {
  commandId: string;
}

export interface KillCommandParams {
  commandId: string;
}

export interface GrepContentParams {
  directory: string;
  filePattern?: string;
  pattern: string;
  recursive?: boolean;
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

export interface ReadFileState {
  /** Character count of the returned content */
  charCount?: number;
  content: string;
  endLine?: number;
  /** Base filename extracted from path */
  filename?: string;
  /** Detected file type (e.g., 'ts', 'md', 'json') */
  fileType?: string;
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
  stderr?: string;
  stdout?: string;
  success: boolean;
}

export interface GetCommandOutputState {
  error?: string;
  newOutput?: string;
  running: boolean;
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
