// ==================== File Operations Params ====================

export interface ListLocalFilesParams {
  directoryPath: string;
}

export interface ReadLocalFileParams {
  endLine?: number;
  path: string;
  startLine?: number;
}

export interface WriteLocalFileParams {
  content: string;
  createDirectories?: boolean;
  path: string;
}

export interface EditLocalFileParams {
  all?: boolean;
  path: string;
  replace: string;
  search: string;
}

export interface SearchLocalFilesParams {
  directory: string;
  fileType?: string;
  keyword?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
}

export interface MoveLocalFilesParams {
  operations: Array<{
    destination: string;
    source: string;
  }>;
}

export interface RenameLocalFileParams {
  newName: string;
  oldPath: string;
}

export interface GlobLocalFilesParams {
  directory?: string;
  pattern: string;
}

export interface ExportFileParams {
  path: string;
}

// ==================== Code Execution Params ====================

export interface ExecuteCodeParams {
  code: string;
  language?: 'javascript' | 'python' | 'typescript';
}

// ==================== Shell Command Params ====================

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

// ==================== Search & Find Params ====================

export interface GrepContentParams {
  directory: string;
  filePattern?: string;
  pattern: string;
  recursive?: boolean;
}
