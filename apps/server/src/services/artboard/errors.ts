import type { ArtboardFinalizeIssue } from './content/finalize';

export type ArtboardServiceErrorCode =
  | 'conflict'
  | 'exists'
  | 'finalize_blocked'
  | 'invalid'
  | 'locked'
  | 'no_project'
  | 'not_found'
  | 'source_denied';

export interface ArtboardServiceErrorData {
  artboardId?: string;
  issues?: ArtboardFinalizeIssue[];
  opIndex?: number;
}

export class ArtboardServiceError extends Error {
  constructor(
    public code: ArtboardServiceErrorCode,
    message: string,
    public data: ArtboardServiceErrorData = {},
  ) {
    super(message);
  }
}
