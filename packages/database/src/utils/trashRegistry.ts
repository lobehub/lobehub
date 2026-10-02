import { TRASH_RETENTION_MS } from '@lobechat/const';
import type { TrashItemMeta, TrashResourceType } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { trashItems } from '../schemas/trash';
import type { LobeChatDatabase } from '../type';

/** Columns a trash-aware row gets when it is moved to the recycle bin. */
export const trashStamp = (now = new Date()) => ({ deletedAt: now, isDeleted: true as const });

/** Columns a restored row gets — NULL, not `false`, is the live state. */
export const restoreStamp = () => ({ deletedAt: null, isDeleted: null });

export interface RegisterTrashItemParams {
  deletedByUserId: string;
  meta?: TrashItemMeta;
  now?: Date;
  resourceId: string;
  resourceType: TrashResourceType;
  title?: string | null;
  userId: string;
  workspaceId?: string | null;
}

/**
 * Index a freshly trashed root in `trash_items` so it appears in the recycle
 * bin. Idempotent: trashing the same resource twice keeps the first entry.
 */
export const registerTrashItem = async (
  db: LobeChatDatabase,
  params: RegisterTrashItemParams,
): Promise<void> => {
  const now = params.now ?? new Date();

  await db
    .insert(trashItems)
    .values({
      deletedAt: now,
      deletedByUserId: params.deletedByUserId,
      expiresAt: new Date(now.getTime() + TRASH_RETENTION_MS),
      meta: params.meta,
      resourceId: params.resourceId,
      resourceType: params.resourceType,
      title: params.title ?? null,
      userId: params.userId,
      workspaceId: params.workspaceId ?? null,
    })
    .onConflictDoNothing({ target: [trashItems.resourceType, trashItems.resourceId] });
};

/** Drop the recycle-bin entry of a restored or hard-deleted resource. */
export const unregisterTrashItem = async (
  db: LobeChatDatabase,
  resourceType: TrashResourceType,
  resourceId: string,
): Promise<void> => {
  await db
    .delete(trashItems)
    .where(and(eq(trashItems.resourceType, resourceType), eq(trashItems.resourceId, resourceId)));
};
