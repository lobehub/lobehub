import type { AgentAccess } from '@/database/models/agentDocuments';

/**
 * Mounted subtree provenance for a VFS node.
 *
 * Use when:
 * - The caller needs to know whether a node comes from ordinary agent documents or a mounted tree
 * - CLI or tooling wants to surface the mounted namespace for debugging
 *
 * Expects:
 * - `driver` identifies the mounted implementation
 * - `namespace` and `source` are driver-local strings
 */
export interface AgentDocumentMountInfo {
  /**
   * Stable mounted driver name such as `agent-documents` or `skills`.
   */
  driver: string;
  /**
   * Driver-local namespace such as `agent` or `builtin`.
   */
  namespace?: string;
  /**
   * Driver-local source identifier such as `documents`, `builtin`, or `installed`.
   */
  source?: string;
}

/**
 * Lightweight VFS node returned from directory listings.
 *
 * Use when:
 * - Rendering `ls` or `tree`
 * - Paging through a directory without loading document content
 *
 * Expects:
 * - `type` determines whether the entry is a file or directory
 * - `mode` reuses current self-channel `AgentAccess` bits
 *
 * Returns:
 * - A plain-data node safe to serialize through TRPC/CLI boundaries
 */
export interface AgentDocumentNode {
  agentDocumentId?: string;
  createdAt?: Date;
  documentId?: string;
  id: string;
  mode: AgentAccess;
  mount?: AgentDocumentMountInfo;
  name: string;
  path: string;
  size?: number;
  type: 'directory' | 'file';
  updatedAt?: Date;
}

/**
 * Detailed VFS state for a single node.
 *
 * Use when:
 * - Rendering `stat`
 * - Inspecting a VFS node without reading its file body
 *
 * Expects:
 * - Stable callers use `readDocumentByPath` / `AgentDocumentReadResult` for file bodies
 *
 * Returns:
 * - A richer node carrying metadata without file content
 */
export interface AgentDocumentStats extends AgentDocumentNode {
  contentType?: string;
  deletedAt?: Date | null;
  deleteReason?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Flat trash entry returned from VFS trash listings.
 *
 * Use when:
 * - Rendering `agent space fs trash ls`
 * - Restoring or permanently deleting a soft-deleted entry
 *
 * Expects:
 * - `deletedAt` is always populated for trash entries
 */
export interface AgentDocumentTrashEntry extends AgentDocumentStats {
  deletedAt: Date;
}

/**
 * Read result for file content operations.
 *
 * Use when:
 * - A caller wants file content without the rest of the `stat` payload
 *
 * Returns:
 * - File content plus the resolved VFS path
 */
export interface AgentDocumentReadResult {
  content: string;
  contentType?: string;
  path: string;
}

/**
 * Listing detail level for directory traversal.
 *
 * Use when:
 * - The caller wants the default listing payload or a richer debug-oriented payload
 */
export type AgentDocumentListDetail = 'basic' | 'full';

/**
 * Options accepted by VFS directory listings.
 *
 * Use when:
 * - Paginating a directory
 * - Asking for richer list payloads
 *
 * Expects:
 * - `detail` defaults to `basic`
 * - `cursor` and `limit` are optional migration-friendly placeholders while the first pass returns arrays
 */
export interface AgentDocumentListOptions {
  cursor?: string;
  detail?: AgentDocumentListDetail;
  limit?: number;
}

/**
 * Paged VFS directory listing result.
 *
 * Use when:
 * - A caller needs cursor-aware directory traversal
 * - Future router APIs should expose pagination without changing node payloads
 *
 * Expects:
 * - `items` contains direct children only
 * - `nextCursor` is omitted when there are no more entries
 *
 * Returns:
 * - Serializable listing data for ordinary documents and mounted subtrees
 */
export interface AgentDocumentListResult {
  items: AgentDocumentNode[];
  nextCursor?: string;
}

/**
 * Type guard for file-like VFS nodes.
 *
 * Before:
 * - `node.type === 'file'`
 *
 * After:
 * - `isAgentDocumentFile(node) === true`
 */
export const isAgentDocumentFile = (
  node: Pick<AgentDocumentNode, 'type'>,
): node is Pick<AgentDocumentNode, 'type'> & { type: 'file' } => node.type === 'file';

/**
 * Type guard for directory-like VFS nodes.
 *
 * Before:
 * - `node.type === 'directory'`
 *
 * After:
 * - `isAgentDocumentDirectory(node) === true`
 */
export const isAgentDocumentDirectory = (
  node: Pick<AgentDocumentNode, 'type'>,
): node is Pick<AgentDocumentNode, 'type'> & { type: 'directory' } => node.type === 'directory';
