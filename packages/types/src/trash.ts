/**
 * Entity kinds that can be moved to the recycle bin instead of being hard
 * deleted. Polymorphic on purpose (mirroring `resource_permissions` and
 * `resource_transfer_requests`): a new trash-aware entity only needs a new
 * literal here plus a handler in the server `TrashService` — never a new
 * table.
 *
 * Phase 1 wires up the chat domain (agent / topic / message); the remaining
 * content kinds (chat groups, pages, files, knowledge bases, projects, tasks,
 * generation topics) follow once the pattern has proven itself — see
 * docs/development/soft-delete-recycle-bin-design.md.
 *
 * Only *root* kinds are user-visible in the recycle bin. Rows that were
 * trashed as part of a parent's cascade (e.g. a topic under a trashed agent)
 * are still registered as `trash_items` children so a restore / purge of the
 * root can find them, but the UI never lists them on their own.
 */
export const TRASH_RESOURCE_TYPES = ['agent', 'topic', 'message'] as const;
export type TrashResourceType = (typeof TRASH_RESOURCE_TYPES)[number];

/**
 * Lightweight, denormalised snapshot captured at trash time so the recycle
 * bin list can render a row without joining the source table. Kept small on
 * purpose — the source row is still there until purge, so anything heavier
 * can be resolved lazily.
 */
export interface TrashItemMeta {
  avatar?: string | null;
  backgroundColor?: string | null;
  /** Number of cascaded children registered under this root (topics under an agent …) */
  childCount?: number;
  /** e.g. mime type for files, `sourceType` for documents */
  kind?: string | null;
  /**
   * Message-only: original `parentId` and the child ids that were re-parented
   * onto it at trash time, so a restore can splice the message back into its
   * branch (see `MessageModel.softDeleteMessages`).
   */
  messageTree?: { childIds: string[]; parentId: string | null };
  /** Human readable parent title (agent name for a topic, folder for a page …) */
  parentTitle?: string | null;
  /**
   * Topic-only: the user asked for the topic's attachments to go with it.
   * Files are not trash-aware yet, so they stay live while the topic sits in
   * the bin and are removed (with their storage objects) when it is purged.
   */
  removeFiles?: boolean;
  /** Message-only: role of the trashed message, drives the list glyph. */
  role?: string | null;
  size?: number | null;
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
