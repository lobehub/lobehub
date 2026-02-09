/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Define types for local file operations
export interface LocalFileItem {
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

export type ListLocalFileSortBy = 'name' | 'modifiedTime' | 'createdTime' | 'size';
export type ListLocalFileSortOrder = 'asc' | 'desc';

export interface ListLocalFileParams {
  /**
   * Maximum number of files to return
   * @default 100
   */
  limit?: number;
  /**
   * Directory path to list
   */
  path: string;
  /**
   * Field to sort by
   * @default 'modifiedTime'
   */
  sortBy?: ListLocalFileSortBy;
  /**
   * Sort order
   * @default 'desc'
   */
  sortOrder?: ListLocalFileSortOrder;
}

export interface ListLocalFilesResult {
  /**
   * List of files (truncated to limit)
   */
  files: LocalFileItem[];
  /**
   * Total count of files before truncation
   */
  totalCount: number;
}

export interface MoveLocalFileParams {
  newPath: string;
  oldPath: string;
}

export interface MoveLocalFilesParams {
  items: MoveLocalFileParams[];
}

export interface LocalMoveFilesResultItem {
  error?: string; // Error message if this specific item failed
  newPath?: string; // The final path after moving/renaming, if successful
  sourcePath: string; // The original path of the item being moved/renamed
  success: boolean; // Whether the operation for this specific item was successful
}

export interface RenameLocalFileParams {
  newName: string;
  path: string;
}

export interface RenameLocalFileResult {
  error?: any;
  newPath: string;
  success: boolean;
}

export interface LocalReadFileParams {
  fullContent?: boolean;
  loc?: [number, number];
  path: string;
}

export interface LocalReadFilesParams {
  paths: string[];
}

export interface WriteLocalFileParams {
  /**
   * Content to write
   */
  content: string;

  /**
   * File path to write to
   */
  path: string;
}

export interface LocalReadFileResult {
  /**
   * Character count of the content within the specified `loc` range.
   */
  charCount: number;
  /**
   * Content of the file within the specified `loc` range.
   */
  content: string;
  createdTime: Date;
  fileType: string;
  filename: string;
  /**
   * Line count of the content within the specified `loc` range.
   */
  lineCount: number;
  loc: [number, number];
  modifiedTime: Date;
  /**
   * Total character count of the entire file.
   */
  totalCharCount: number;
  /**
   * Total line count of the entire file.
   */
  totalLineCount: number;
}

export interface LocalSearchFilesParams {
  // Basic search
  keywords: string;

  // Path options
  directory?: string; // Limit search to specific directory
  exclude?: string[]; // Paths to exclude from search

  // File type options
  fileTypes?: string[]; // File extensions to filter (e.g., ['pdf', 'docx'])

  // Content options
  contentContains?: string; // Search for files containing specific text

  // Time options (ISO 8601 date strings)
  createdAfter?: string;
  createdBefore?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;

  // Result options
  detailed?: boolean;
  limit?: number;
  liveUpdate?: boolean;
  sortBy?: 'name' | 'date' | 'size';
  sortDirection?: 'asc' | 'desc';
}

export interface OpenLocalFileParams {
  path: string;
}

export interface OpenLocalFolderParams {
  isDirectory?: boolean;
  path: string;
}

// Shell command types
export interface RunCommandParams {
  command: string;
  description?: string;
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

// Grep types
export interface GrepContentParams {
  '-A'?: number;
  '-B'?: number;
  '-C'?: number;
  '-i'?: boolean;
  '-n'?: boolean;
  'glob'?: string;
  'head_limit'?: number;
  'multiline'?: boolean;
  'output_mode'?: 'content' | 'files_with_matches' | 'count';
  'path'?: string;
  'pattern': string;
  'type'?: string;
}

export interface GrepContentResult {
  matches: string[];
  success: boolean;
  total_matches: number;
}

// Glob types
export interface GlobFilesParams {
  path?: string;
  pattern: string;
}

export interface GlobFilesResult {
  files: string[];
  success: boolean;
  total_files: number;
}

// Edit types
export interface EditLocalFileParams {
  file_path: string;
  new_string: string;
  old_string: string;
  replace_all?: boolean;
}

export interface EditLocalFileResult {
  diffText?: string;
  error?: string;
  linesAdded?: number;
  linesDeleted?: number;
  replacements: number;
  success: boolean;
}

// Save Dialog types
export interface ShowSaveDialogParams {
  /**
   * Default file name
   */
  defaultPath?: string;
  /**
   * File type filters
   */
  filters?: { extensions: string[]; name: string }[];
  /**
   * Dialog title
   */
  title?: string;
}

export interface ShowSaveDialogResult {
  /**
   * Whether the dialog was cancelled
   */
  canceled: boolean;
  /**
   * The selected file path (undefined if cancelled)
   */
  filePath?: string;
}
