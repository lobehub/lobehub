export interface MarkdownPatchHunk {
  replace: string;
  replaceAll?: boolean;
  search: string;
}

export interface MarkdownPatchSuccess {
  applied: number;
  content: string;
  ok: true;
}

export type MarkdownPatchErrorCode =
  | 'EMPTY_HUNKS'
  | 'EMPTY_SEARCH'
  | 'HUNK_AMBIGUOUS'
  | 'HUNK_NOT_FOUND';

export interface MarkdownPatchErrorDetail {
  code: MarkdownPatchErrorCode;
  hunkIndex: number;
  occurrences?: number;
  search?: string;
}

export interface MarkdownPatchFailure {
  error: MarkdownPatchErrorDetail;
  ok: false;
}

export type MarkdownPatchResult = MarkdownPatchFailure | MarkdownPatchSuccess;
