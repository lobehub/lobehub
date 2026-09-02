/**
 * Entity kinds that can be moved to the recycle bin instead of being hard
 * deleted. Polymorphic on purpose (mirroring `resource_permissions` and
 * `resource_transfer_requests`): a new trash-aware entity only needs a new
 * literal here plus a handler in the server `TrashService` — never a new
 * table.
 *
 * This recycle bin is intentionally limited to the Resource domain. Chat,
 * agent, task, and other product domains keep their existing delete behavior.
 *
 * Only *root* kinds are user-visible in the recycle bin. Rows that were
 * trashed as part of a Resource cascade (e.g. a document under a trashed
 * folder) are still registered as `trash_items` children so a restore / purge
 * of the root can find them, but the UI never lists them on their own.
 */
export const TRASH_RESOURCE_TYPES = ['file', 'document', 'knowledgeBase'] as const;
export type TrashResourceType = (typeof TRASH_RESOURCE_TYPES)[number];

/**
 * Lightweight, denormalised snapshot captured at trash time so the recycle
 * bin list can render a row without joining the source table. Kept small on
 * purpose — the source row is still there until purge, so anything heavier
 * can be resolved lazily.
 */
export interface TrashItemMeta {
  avatar?: string | null;
  /** Original resource creator; differs from the delete actor in a shared workspace. */
  creatorUserId?: string | null;
  /** e.g. mime type for files, `sourceType` for documents */
  kind?: string | null;
  /** Original knowledge base, when the resource is directly attached to one. */
  knowledgeBaseId?: string | null;
  /** Original folder parent, retained for audit and restore context. */
  parentId?: string | null;
  size?: number | null;
  /**
   * Durable hand-off for backing objects that must be removed after the
   * database purge commits. Kept on the root registry row so a failed storage
   * request can be retried after the source file rows are already gone.
   */
  storageCleanup?: {
    files: { fileHash: string; url: string }[];
    pending: true;
  };
  /** Visibility snapshot used to keep private resources out of teammates' bins. */
  visibility?: 'private' | 'public' | null;
}

export interface TrashItem {
  deletedAt: Date;
  deletedByUserId: string | null;
  expiresAt: Date;
  id: string;
  meta: TrashItemMeta | null;
  resourceId: string;
  resourceType: TrashResourceType;
  /** Null for roots; set for rows that were cascaded from a trashed parent */
  rootId: string | null;
  title: string | null;
  userId: string;
  workspaceId: string | null;
}

export interface TrashListParams {
  cursor?: string | null;
  limit?: number;
  resourceType?: TrashResourceType;
}

export interface TrashListResult {
  items: TrashItem[];
  nextCursor: string | null;
}

export type TrashCountByType = Partial<Record<TrashResourceType, number>>;

/**
 * Why a restore was refused. Surfaced to the client so it can explain the
 * situation instead of showing a generic error.
 */
export const TRASH_RESTORE_ERROR_CODES = [
  /** The row is already gone (purged / hard deleted through another path). */
  'notFound',
  /** A parent of the row is itself in the trash — restore that root first. */
  'parentTrashed',
] as const;
export type TrashRestoreErrorCode = (typeof TRASH_RESTORE_ERROR_CODES)[number];
