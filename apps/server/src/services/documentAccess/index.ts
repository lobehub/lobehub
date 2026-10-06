import { TRPCError } from '@trpc/server';

import { assertContentsNotInRestrictedKnowledgeBase } from '@/server/services/knowledgeBaseAccess';
import { canPerformResourceAction } from '@/server/services/resourcePermission';

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
