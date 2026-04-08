// Re-export shared state types from @lobechat/tool-runtime
export type {
  EditFileState as EditLocalFileState,
  GetCommandOutputState,
  GlobFilesState,
  GrepContentState,
  KillCommandState,
  ListFilesState as ListLocalFilesState,
  MoveFilesState as MoveLocalFilesState,
  ReadFileState as ReadLocalFileState,
  RenameFileState as RenameLocalFileState,
  RunCommandState,
  SearchFilesState as SearchLocalFilesState,
  WriteFileState as WriteLocalFileState,
} from '@lobechat/tool-runtime';

// ==================== Cloud-Specific State ====================

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

// ==================== Session Info ====================

export interface SessionInfo {
  sessionExpiredAndRecreated: boolean;
  sessionId: string;
}
