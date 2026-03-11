import  {
  type GetCommandOutputResult,
  type GlobFilesResult,
  type GrepContentResult,
  type KillCommandResult,
  type LocalFileItem,
  type LocalMoveFilesResultItem,
  type LocalReadFileResult,
  type RunCommandResult,
} from '@lobechat/electron-client-ipc';

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

export interface RunCommandState {
  message: string;
  result: RunCommandResult;
}

export interface GetCommandOutputState {
  message: string;
  result: GetCommandOutputResult;
}

export interface KillCommandState {
  message: string;
  result: KillCommandResult;
}

export interface GrepContentState {
  message: string;
  /** Resolved search path after scope resolution */
  resolvedPath?: string;
  result: GrepContentResult;
}

export interface GlobFilesState {
  message: string;
  /** Resolved full glob (path + pattern) after scope resolution. May contain glob metacharacters like `*` or `**`. */
  resolvedPath?: string;
  result: GlobFilesResult;
}

export interface EditLocalFileState {
  diffText?: string;
  linesAdded?: number;
  linesDeleted?: number;
  replacements: number;
}
