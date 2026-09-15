/**
 * Server-facing re-export of the pure rewrite state machine. Keeping these
 * functions free of database/provider imports makes them safe for queue
 * handlers, API validation, and deterministic unit tests.
 */
export type {
  DocumentRewriteTerminalStatus,
  DocumentRewriteTransientStatus,
} from '@/database/models/documentRewriteRequestState';
export {
  assertDocumentRewriteTransition,
  canRetryDocumentRewrite,
  canTransitionDocumentRewrite,
  DOCUMENT_REWRITE_ACTIVE_CLAIM_STATUSES,
  DOCUMENT_REWRITE_TERMINAL_STATUSES,
  DOCUMENT_REWRITE_TRANSIENT_STATUSES,
  DocumentRewriteTransitionError,
  isDocumentRewriteTerminal,
  isDocumentRewriteTransient,
} from '@/database/models/documentRewriteRequestState';
