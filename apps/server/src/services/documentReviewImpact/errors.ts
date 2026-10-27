/**
 * Explicit failure modes of the impact analysis. The router maps each code to a
 * tRPC error, so the client can tell "pick a baseline" from "the model failed"
 * without parsing a message.
 */
export type DocumentImpactErrorCode =
  | 'BASELINE_NOT_FOUND'
  | 'DOCUMENT_NOT_FOUND'
  | 'EMPTY_BASELINE'
  | 'EMPTY_DOCUMENT'
  | 'IMPACT_NOT_FOUND'
  | 'LLM_FAILED'
  | 'NO_BASELINE'
  | 'NO_DIFF'
  | 'SCHEMA_INVALID'
  | 'SESSION_NOT_FOUND';

export class DocumentImpactError extends Error {
  readonly code: DocumentImpactErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DocumentImpactErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DocumentImpactError';
    this.code = code;
    this.details = details;
  }
}

export const isDocumentImpactError = (error: unknown): error is DocumentImpactError =>
  error instanceof DocumentImpactError;
