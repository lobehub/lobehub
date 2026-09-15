import type { DocumentRewriteRequestStatus } from '../schemas/documentRewriteRequest';

export const DOCUMENT_REWRITE_TRANSIENT_STATUSES = [
  'queued',
  'connecting',
  'syncing',
  'thinking',
  'writing',
  'cancel_requested',
  'retry_wait',
] as const satisfies readonly DocumentRewriteRequestStatus[];

export type DocumentRewriteTransientStatus = (typeof DOCUMENT_REWRITE_TRANSIENT_STATUSES)[number];

export const DOCUMENT_REWRITE_TERMINAL_STATUSES = [
  'applied',
  'rejected',
  'canceled',
  'canceled_after_write',
  'stale',
  'failed',
] as const satisfies readonly DocumentRewriteRequestStatus[];

export type DocumentRewriteTerminalStatus = (typeof DOCUMENT_REWRITE_TERMINAL_STATUSES)[number];

export const DOCUMENT_REWRITE_ACTIVE_CLAIM_STATUSES = [
  'connecting',
  'syncing',
  'thinking',
  'writing',
  'cancel_requested',
] as const satisfies readonly DocumentRewriteRequestStatus[];

const transitions: Record<DocumentRewriteRequestStatus, readonly DocumentRewriteRequestStatus[]> = {
  applied: [],
  awaiting_review: ['applied', 'rejected', 'stale', 'failed'],
  canceled: [],
  // A command/diff already exists. Review may settle it, but retry is
  // intentionally not a legal direct transition until that pending diff has
  // been accepted or rejected.
  canceled_after_write: ['applied', 'rejected', 'stale', 'failed'],
  // A direct command may already be in the room when cancellation is
  // observed. There is no safe rollback path for that update, so the worker
  // must finish the persistence proof and settle it as applied.
  cancel_requested: ['applied', 'canceled', 'canceled_after_write', 'stale', 'failed'],
  connecting: ['syncing', 'cancel_requested', 'retry_wait', 'stale', 'failed'],
  failed: [],
  queued: ['connecting', 'canceled', 'stale', 'failed'],
  rejected: [],
  retry_wait: ['queued', 'connecting', 'canceled', 'stale', 'failed'],
  stale: [],
  syncing: ['thinking', 'cancel_requested', 'retry_wait', 'stale', 'failed'],
  thinking: ['writing', 'cancel_requested', 'retry_wait', 'stale', 'failed'],
  writing: [
    'applied',
    'awaiting_review',
    'cancel_requested',
    'canceled_after_write',
    'retry_wait',
    'stale',
    'failed',
  ],
};

export class DocumentRewriteTransitionError extends Error {
  constructor(
    public readonly from: DocumentRewriteRequestStatus,
    public readonly to: DocumentRewriteRequestStatus,
  ) {
    super(`Invalid document rewrite transition: ${from} -> ${to}`);
    this.name = 'DocumentRewriteTransitionError';
  }
}

export const isDocumentRewriteTerminal = (
  status: DocumentRewriteRequestStatus,
): status is DocumentRewriteTerminalStatus =>
  (DOCUMENT_REWRITE_TERMINAL_STATUSES as readonly string[]).includes(status);

export const isDocumentRewriteTransient = (
  status: DocumentRewriteRequestStatus,
): status is DocumentRewriteTransientStatus =>
  (DOCUMENT_REWRITE_TRANSIENT_STATUSES as readonly string[]).includes(status);

export const canTransitionDocumentRewrite = (
  from: DocumentRewriteRequestStatus,
  to: DocumentRewriteRequestStatus,
): boolean => from === to || transitions[from].includes(to);

export const assertDocumentRewriteTransition = (
  from: DocumentRewriteRequestStatus,
  to: DocumentRewriteRequestStatus,
): void => {
  if (!canTransitionDocumentRewrite(from, to)) {
    throw new DocumentRewriteTransitionError(from, to);
  }
};

/** Explicit user retry is the only operation allowed to leave a terminal row. */
export const canRetryDocumentRewrite = (
  status: DocumentRewriteRequestStatus,
): status is Extract<DocumentRewriteRequestStatus, 'canceled' | 'failed' | 'stale'> =>
  status === 'canceled' || status === 'failed' || status === 'stale';
