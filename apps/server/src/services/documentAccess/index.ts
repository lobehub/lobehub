import { TRPCError } from '@trpc/server';

import type { DocumentItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { assertContentsNotInRestrictedKnowledgeBase } from '@/server/services/knowledgeBaseAccess';
import { canPerformResourceAction, getResourceMeta } from '@/server/services/resourcePermission';

type DocumentContentAccessParams = Pick<
  Parameters<typeof canPerformResourceAction>[0],
  'db' | 'grantedPermissions' | 'meta' | 'resourceId' | 'userId' | 'workspaceId'
>;

/** Document notifications must honor the same knowledge-base restrictions as content reads. */
export const canViewDocumentContent = async (
  params: DocumentContentAccessParams,
): Promise<boolean> => {
  const canView = await canPerformResourceAction({
    ...params,
    action: 'view',
    effectiveAccessLevel: 'view',
    resourceType: 'document',
  });
  if (!canView) return false;

  try {
    await assertContentsNotInRestrictedKnowledgeBase(
      { serverDB: params.db, userId: params.userId, workspaceId: params.workspaceId },
      [params.resourceId],
    );
    return true;
  } catch (error) {
    if (error instanceof TRPCError && error.code === 'FORBIDDEN') return false;
    throw error;
  }
};

interface DocumentViewerContext {
  documentService: { getDocumentById: (id: string) => Promise<DocumentItem | undefined> };
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
  workspacePermissionCodes?: string[];
}

/**
 * Read a document for a viewer, telling "no access" apart from "not found".
 *
 * The scoped read hides another member's private page exactly like a missing
 * row. Inside the caller's workspace that would render a 404 for a page that
 * exists, so throw FORBIDDEN instead — the same split
 * `assertCanPerformResourceAction` makes. Rows outside the workspace stay hidden.
 */
export const getDocumentForViewer = async (
  ctx: DocumentViewerContext,
  id: string,
): Promise<DocumentItem | undefined> => {
  const doc = await ctx.documentService.getDocumentById(id);
  if (doc || !ctx.workspaceId) return doc;

  const meta = await getResourceMeta(ctx.serverDB, 'document', id);
  if (!meta || meta.workspaceId !== ctx.workspaceId) return doc;

  const canView = await canViewDocumentContent({
    db: ctx.serverDB,
    grantedPermissions: ctx.workspacePermissionCodes,
    meta,
    resourceId: id,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
  if (canView) return doc;

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'You do not have permission to view this document',
  });
};
