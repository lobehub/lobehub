import type { TrashResourceType, TrashRestoreErrorCode } from '@lobechat/types';

import type { TrashRegisterEntry } from '@/database/models/trash';
import type { TrashItemRow } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import type { FileService } from '@/server/services/file';

/**
 * Per-request context handed to every handler. `db` may be a transaction
 * client — handlers must build their models on it rather than reaching for a
 * global instance so a failure between "stamp the rows" and "register them"
 * rolls back both.
 */
export interface TrashHandlerContext {
  db: LobeChatDatabase;
  fileService: FileService;
  userId: string;
  workspaceId?: string;
}

/** What a soft delete produced: the root registry entry plus every cascaded child. */
export interface TrashCascade {
  children: TrashRegisterEntry[];
  root: TrashRegisterEntry;
}

export class TrashRestoreError extends Error {
  constructor(
    public readonly code: TrashRestoreErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'TrashRestoreError';
  }
}

/**
 * One handler per {@link TrashResourceType}. A handler owns three things:
 * how its rows are stamped (and which children go along), how they come back,
 * and how they are finally hard-deleted — including external side effects
 * (S3 objects) that only run at purge time.
 */
export interface TrashHandler {
  /**
   * Hard-delete the root and its registered children. Runs after the row has
   * been in the bin for the retention window, or when the user empties the bin.
   */
  purge: (ctx: TrashHandlerContext, root: TrashItemRow, children: TrashItemRow[]) => Promise<void>;
  /**
   * Un-stamp the root and its registered children. Must throw
   * {@link TrashRestoreError} with `parentTrashed` when a parent of the root is
   * itself in the bin (the user has to restore that root first), and with
   * `notFound` when the source row is gone.
   */
  restore: (
    ctx: TrashHandlerContext,
    root: TrashItemRow,
    children: TrashItemRow[],
  ) => Promise<void>;
  type: TrashResourceType;
}
