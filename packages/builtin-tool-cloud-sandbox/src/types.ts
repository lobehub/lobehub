/**
 * API names for Cloud Sandbox tool
 */
export const CloudSandboxApiName = {
  editLocalFile: 'editLocalFile',
  executeCode: 'executeCode',
  exportFile: 'exportFile',
  getCommandOutput: 'getCommandOutput',
  globLocalFiles: 'globLocalFiles',
  grepContent: 'grepContent',
  killCommand: 'killCommand',
  listLocalFiles: 'listLocalFiles',
  moveLocalFiles: 'moveLocalFiles',
  readLocalFile: 'readLocalFile',
  renameLocalFile: 'renameLocalFile',
  runCommand: 'runCommand',
  searchLocalFiles: 'searchLocalFiles',
  writeLocalFile: 'writeLocalFile',
} as const;

export type CloudSandboxApiNameType =
  (typeof CloudSandboxApiName)[keyof typeof CloudSandboxApiName];

// ==================== File Operations ====================

export interface ListLocalFilesState {
  files: Array<{
    isDirectory: boolean;
    name: string;
    path: string;
    size?: number;
  }>;
}

export interface ReadLocalFileState {
  content: string;
  endLine?: number;
  path: string;
  startLine?: number;
  totalLines?: number;
}

export interface WriteLocalFileState {
  bytesWritten?: number;
  path: string;
  success: boolean;
}

export interface EditLocalFileState {
  diffText?: string;
  linesAdded?: number;
  linesDeleted?: number;
  path: string;
  replacements: number;
}

export interface SearchLocalFilesState {
  results: Array<{
    isDirectory: boolean;
    modifiedAt?: string;
    name: string;
    path: string;
    size?: number;
  }>;
  totalCount: number;
}

export interface MoveLocalFilesState {
  results: Array<{
    destination: string;
    error?: string;
    source: string;
    success: boolean;
  }>;
  successCount: number;
  totalCount: number;
}

export interface RenameLocalFileState {
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

export interface ExportFileState {
  /** The download URL for the exported file (permanent /f/:id URL) */
  downloadUrl: string;
  /** The file ID in database (returned from server) */
  fileId?: string;
  /** The exported file name */
  filename: string;
  /** The MIME type of the file */
  mimeType?: string;
  /** The original path in sandbox */
  path: string;
  /** The file size in bytes */
  size?: number;
  /** Whether the export was successful */
  success: boolean;
}

export interface GrepContentState {
  matches: Array<{
    content?: string;
    lineNumber?: number;
    path: string;
  }>;
  pattern: string;
  totalMatches: number;
}

// ==================== Code Execution ====================

export interface ExecuteCodeState {
  /** Error message if execution failed */
  error?: string;
  /** Exit code of the execution */
  exitCode?: number;
  /** The programming language used */
  language: 'javascript' | 'python' | 'typescript';
  /** Standard output from execution */
  output?: string;
  /** Standard error from execution */
  stderr?: string;
  /** Whether the execution was successful */
  success: boolean;
}

// ==================== Shell Commands ====================

export interface RunCommandState {
  commandId?: string;
  error?: string;
  exitCode?: number;
  isBackground: boolean;
  output?: string;
  stderr?: string;
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

// ==================== Session Info ====================

export interface SessionInfo {
  sessionExpiredAndRecreated: boolean;
  sessionId: string;
}
