/**
 * Error codes owned by the review services. The router maps them onto tRPC
 * codes; keeping the domain codes here makes tests assert meaning rather than
 * HTTP status.
 */
export const REVIEW_ERROR_CODES = [
  'LLM_FAILED',
  'SCHEMA_INVALID',
  'NO_OP_SUGGESTION',
  'ANCHOR_LOST',
  'ANCHOR_AMBIGUOUS',
  'SUGGESTION_NOT_FOUND',
  'NO_TARGET_TEXT',
  'CHECK_RESULT_NOT_FOUND',
  'DOCUMENT_NOT_FOUND',
  'UNSUPPORTED_DOCUMENT',
  'ILLEGAL_TRANSITION',
] as const;

export type ReviewErrorCode = (typeof REVIEW_ERROR_CODES)[number];

export class ReviewServiceError extends Error {
  readonly code: ReviewErrorCode;

  constructor(code: ReviewErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ReviewServiceError';
  }
}

export const isReviewServiceError = (error: unknown): error is ReviewServiceError =>
  error instanceof ReviewServiceError;
