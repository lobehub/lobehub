import { and, inArray } from 'drizzle-orm';
import pMap from 'p-map';

import { quickNoteTopicAccessWhere } from '@/database/models/quickNote';
import { topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { canPerformResourceAction, getResourceMeta } from '@/server/services/resourcePermission';
import { resolveWorkspaceGrantedPermissions } from '@/server/services/workspacePermission';

const isDocumentReference = (type: string) => type === 'document' || type === 'page';
const isTopicReference = (type: string) => type === 'topic' || type === 'conversation';

/** Caps the document permission checks run at once, since each one reads the database. */
const VIEW_CHECK_CONCURRENCY = 10;

/**
 * Drops Document, Page, Topic, and conversation references the caller may not view in the
 * current workspace.
 *
 * Use when:
 * - Linking resources to a Quick Note, or returning the links it holds.
 *
 * Expects:
 * - Documents and Pages: the database layer checks workspace and visibility; this adds the
 *   workspace RBAC (`DOCUMENT_READ`) and per-Document access level only the server can evaluate.
 * - Topics and conversations: only the caller's own Topics in the workspace are viewable
 *   (`quickNoteTopicAccessWhere`), so a link to another member's Topic is dropped even if it was
 *   stored before that rule or reported by the Analyze Agent.
 * - Personal scope needs no extra check: the database already limits it to the caller's rows.
 *
 * Returns:
 * - The references the caller may view, in their original order.
 */
export const filterViewableResources = async <T>(
  params: { db: LobeChatDatabase; userId: string; workspaceId?: string },
  references: T[],
  select: (reference: T) => { id: string; type: string },
): Promise<T[]> => {
  const { db, userId, workspaceId } = params;
  if (!workspaceId) return references;

  const selected = references.map(select);
  const hasDocuments = selected.some(({ type }) => isDocumentReference(type));
  const topicIds = [
    ...new Set(selected.flatMap(({ id, type }) => (isTopicReference(type) ? [id] : []))),
  ];
  if (!hasDocuments && topicIds.length === 0) return references;

  const [grantedPermissions, viewableTopicIds] = await Promise.all([
    hasDocuments ? resolveWorkspaceGrantedPermissions({ db, userId, workspaceId }) : undefined,
    topicIds.length === 0
      ? new Set<string>()
      : db
          .select({ id: topics.id })
          .from(topics)
          .where(
            and(inArray(topics.id, topicIds), quickNoteTopicAccessWhere({ userId, workspaceId })),
          )
          .then((rows) => new Set(rows.map(({ id }) => id))),
  ]);

  const viewable = await pMap(
    selected,
    async ({ id, type }) => {
      if (isTopicReference(type)) return viewableTopicIds.has(id);
      if (!isDocumentReference(type)) return true;

      const meta = await getResourceMeta(db, 'document', id);
      if (!meta) return false;

      return canPerformResourceAction({
        action: 'view',
        db,
        grantedPermissions,
        meta,
        resourceId: id,
        resourceType: 'document',
        userId,
        workspaceId,
      });
    },
    { concurrency: VIEW_CHECK_CONCURRENCY },
  );

  return references.filter((_, index) => viewable[index]);
};
