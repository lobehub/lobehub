// ─── Shell Types ───

export interface RunCommandParams {
  command: string;
  cwd?: string;
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

// ─── File Types ───

export interface ReadFileParams {
  fullContent?: boolean;
  loc?: [number, number];
  path: string;
}

export interface ReadFileResult {
  charCount: number;
  content: string;
  createdTime: Date;
  filename: string;
  fileType: string;
  lineCount: number;
  loc: [number, number];
  modifiedTime: Date;
  totalCharCount: number;
  totalLineCount: number;
}

export interface WriteFileParams {
  content: string;
  path: string;
}

export interface WriteFileResult {
  error?: string;
  success: boolean;
}

export interface EditFileParams {
  file_path: string;
  new_string: string;
  old_string: string;
  replace_all?: boolean;
}

export interface EditFileResult {
  diffText?: string;
  error?: string;
  linesAdded?: number;
  linesDeleted?: number;
  replacements: number;
  success: boolean;
}

export interface ListFilesParams {
  limit?: number;
  path: string;
  sortBy?: 'createdTime' | 'modifiedTime' | 'name' | 'size';
  sortOrder?: 'asc' | 'desc';
}

export interface FileEntry {
  createdTime: Date;
  isDirectory: boolean;
  lastAccessTime: Date;
  modifiedTime: Date;
  name: string;
  path: string;
  size: number;
  type: string;
}

export interface ListFilesResult {
  files: FileEntry[];
  totalCount: number;
}

export interface GlobFilesParams {
  cwd?: string;
  pattern: string;
}

export interface GlobFilesResult {
  error?: string;
  files: string[];
}

export interface SearchFilesParams {
  contentContains?: string;
  directory?: string;
  keywords: string;
  limit?: number;
}

export interface SearchFilesResult {
  name: string;
  path: string;
}

export interface MoveFileItem {
  newPath: string;
  oldPath: string;
}

export interface MoveFilesParams {
  items: MoveFileItem[];
}

export interface MoveFileResultItem {
  error?: string;
  newPath?: string;
  sourcePath: string;
  success: boolean;
}

export interface RenameFileParams {
  newName: string;
  path: string;
}

export interface RenameFileResult {
  error?: string;
  newPath: string;
  success: boolean;
}

export interface GrepContentParams {
  cwd?: string;
  filePattern?: string;
  pattern: string;
}

export interface GrepContentResult {
  error?: string;
  matches: any[];
  success: boolean;
}
