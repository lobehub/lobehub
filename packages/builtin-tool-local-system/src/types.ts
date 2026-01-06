import {
  GetCommandOutputResult,
  GlobFilesResult,
  GrepContentResult,
  KillCommandResult,
  LocalFileItem,
  LocalMoveFilesResultItem,
  LocalReadFileResult,
  RunCommandResult,
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
  searchResults: LocalFileItem[];
}

export interface LocalFileListState {
  listResults: LocalFileItem[];
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
  result: GrepContentResult;
}

export interface GlobFilesState {
  message: string;
  result: GlobFilesResult;
}

export interface EditLocalFileState {
  diffText?: string;
  linesAdded?: number;
  linesDeleted?: number;
  replacements: number;
}
