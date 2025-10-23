import {
  EditLocalFileResult,
  GetCommandOutputResult,
  GlobFilesResult,
  GrepContentResult,
  KillCommandResult,
  LocalFileItem,
  LocalMoveFilesResultItem,
  LocalReadFileResult,
  RunCommandResult,
} from '@lobechat/electron-client-ipc';

export interface FileResult {
  contentType?: string;
  createdTime: Date;
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
  results: LocalMoveFilesResultItem[]; // Overall error for the operation if it fails before individual processing
  successCount: number;
  totalCount: number;
}

export interface LocalRenameFileState {
  error?: string;
  newPath: string;
  oldPath: string;
  success: boolean;
}

// Shell Command States
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

// Search & Find States
export interface GrepContentState {
  message: string;
  result: GrepContentResult;
}

export interface GlobFilesState {
  message: string;
  result: GlobFilesResult;
}

// Edit State
export interface EditLocalFileState {
  message: string;
  result: EditLocalFileResult;
}
