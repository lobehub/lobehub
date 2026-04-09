import type {
  LocalFileItem,
  LocalMoveFilesResultItem,
  LocalReadFileResult,
} from '@lobechat/electron-client-ipc';

// Re-export shared state types from @lobechat/tool-runtime
export type {
  EditFileState as EditLocalFileState,
  GlobFilesState,
  GrepContentState,
  RunCommandState,
} from '@lobechat/tool-runtime';

export const LocalSystemIdentifier = 'lobe-local-system';

export const LocalSystemApiName = {
  editLocalFile: 'editLocalFile',
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
};

export interface FileResult {
  contentType?: string;
  createdTime: Date;
  isDirectory: boolean;
  lastAccessTime: Date;
  metadata?: {
    [key: string]: any;
  };
  modifiedTime: Date;
  name: string;
  path: string;
  size: number;
  type: string;
}

// ==================== Local-System-Specific State Types ====================

export interface LocalFileSearchState {
  /** Search engine used (e.g., 'mdfind', 'fd', 'find', 'fast-glob') */
  engine?: string;
  /** Resolved search directory after scope resolution */
  resolvedPath?: string;
  searchResults: LocalFileItem[];
}

export interface LocalFileListState {
  listResults: LocalFileItem[];
  totalCount: number;
}

export interface LocalReadFileState {
  fileContent: LocalReadFileResult;
}

export interface LocalReadFilesState {
  filesContent: LocalReadFileResult[];
}

export interface LocalMoveFilesState {
  error?: string;
  results: LocalMoveFilesResultItem[];
  successCount: number;
  totalCount: number;
}

export interface LocalRenameFileState {
  error?: string;
  newPath: string;
  oldPath: string;
  success: boolean;
}
