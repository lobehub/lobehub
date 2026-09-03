import { sql } from 'drizzle-orm';

import type { LobeChatDatabase } from '../type';

const hierarchyScope = (userId: string, workspaceId?: string) =>
  workspaceId ? `workspace:${workspaceId}` : `user:${userId}`;

/**
 * Serialize mutations that can change a document tree's reachability.
 *
 * The lock is transaction-scoped. Callers must acquire it before reading a
 * parent/subtree and keep every related write in the same transaction. A
 * workspace-wide key is intentionally used because subtree deletes do not
 * know every concurrent destination/source parent before traversal begins.
 */
export const lockDocumentHierarchy = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
): Promise<void> => {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext('lobehub.document_hierarchy'), hashtext(${hierarchyScope(userId, workspaceId)}))`,
  );
};
