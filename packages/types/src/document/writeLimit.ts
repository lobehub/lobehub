/**
 * Error code a document write carries when it would leave the document longer
 * than the per-document character limit. Sent as `errorData.code` on the TRPC
 * error so the editor, CLI and agent tools can recognize it.
 */
export const DOCUMENT_CHAR_LIMIT_EXCEEDED = 'DocumentCharLimitExceeded';

/**
 * Who asked for a document write. `system` writes (tool-result archives, copies,
 * migrations, generated reports) are never limited.
 */
export type DocumentWriteSource = 'agent' | 'system' | 'user';

/** `errorData` of a write refused by the per-document character limit. */
export interface DocumentCharLimitErrorData {
  /** Length the document would have after the write, in UTF-16 code units. */
  actual: number;
  code: typeof DOCUMENT_CHAR_LIMIT_EXCEEDED;
  limit: number;
  /** Plan the limit comes from, when the deployment has plans. */
  plan?: string;
}
