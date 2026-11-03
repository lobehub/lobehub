export type MarkdownPatchMode = 'replace' | 'delete' | 'deleteLines' | 'insertAt' | 'replaceLines';

export interface MarkdownPatchReplaceHunk {
  mode?: 'replace';
  replace: string;
  replaceAll?: boolean;
  search: string;
}

export interface MarkdownPatchDeleteHunk {
  mode: 'delete';
  replaceAll?: boolean;
  search: string;
}

export interface MarkdownPatchDeleteLinesHunk {
  endLine: number;
  mode: 'deleteLines';
  startLine: number;
}

export interface MarkdownPatchInsertAtHunk {
  content: string;
  line: number;
  mode: 'insertAt';
}

export interface MarkdownPatchReplaceLinesHunk {
  content: string;
  endLine: number;
  mode: 'replaceLines';
  startLine: number;
}

export type MarkdownPatchHunk =
  | MarkdownPatchReplaceHunk
  | MarkdownPatchDeleteHunk
  | MarkdownPatchDeleteLinesHunk
  | MarkdownPatchInsertAtHunk
  | MarkdownPatchReplaceLinesHunk;

export interface MarkdownPatchSuccess {
  applied: number;
  content: string;
  ok: true;
}

export type MarkdownPatchErrorCode =
  | 'EMPTY_HUNKS'
  | 'EMPTY_SEARCH'
  | 'HUNK_AMBIGUOUS'
  | 'HUNK_NOT_FOUND'
  | 'INVALID_LINE_RANGE'
  | 'LINE_OUT_OF_RANGE'
  | 'LINE_OVERLAP';

export interface MarkdownPatchErrorDetail {
  code: MarkdownPatchErrorCode;
  hunkIndex: number;
  line?: number;
  occurrences?: number;
  search?: string;
  totalLines?: number;
}

export interface MarkdownPatchFailure {
  error: MarkdownPatchErrorDetail;
  ok: false;
}

export type MarkdownPatchResult = MarkdownPatchFailure | MarkdownPatchSuccess;
