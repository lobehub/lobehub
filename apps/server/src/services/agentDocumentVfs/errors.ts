export type AgentDocumentVfsErrorCode =
  | 'BAD_REQUEST'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'METHOD_NOT_SUPPORTED'
  | 'NOT_FOUND';

/**
 * Represents VFS and mounted-subtree operation failures.
 *
 * Use when:
 * - Agent document VFS path validation fails.
 * - A mounted VFS adapter rejects a read, write, delete, or promotion.
 *
 * Expects:
 * - `code` maps directly to a tRPC error code at router boundaries.
 *
 * Returns:
 * - A typed error that keeps VFS failures independent from skill-domain errors.
 */
export class AgentDocumentVfsError extends Error {
  code: AgentDocumentVfsErrorCode;

  constructor(message: string, code: AgentDocumentVfsErrorCode) {
    super(message);
    this.name = 'AgentDocumentVfsError';
    this.code = code;
  }
}
