import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { getWorkspaceScopedPermissionMatches } from '@/server/services/workspacePermission';

import { assertCanViewTopicTargets } from './conversationResourceGuard';

export const assertTopicCommentReadAccess = async (params: {
  db: LobeChatDatabase;
  grantedPermissions?: readonly string[];
  hideExistence?: boolean;
  topicId: string;
  userId: string;
  workspaceId: string;
}) => {
  const permissions = await getWorkspaceScopedPermissionMatches({
    action: 'TOPIC_COMMENT_READ',
    db: params.db,
    grantedPermissions: params.grantedPermissions,
    userId: params.userId,
    workspaceId: params.workspaceId,
  });
  if (!permissions.hasAllScope && !permissions.hasOwnerScope) {
    throw new TRPCError({
      code: params.hideExistence ? 'NOT_FOUND' : 'FORBIDDEN',
      message: 'Topic comment resource not found',
    });
  }

  const [topic] = await params.db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.id, params.topicId), eq(topics.workspaceId, params.workspaceId)))
    .limit(1);
  if (!topic) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic comment resource not found' });
  }

  try {
    await assertCanViewTopicTargets(
      {
        db: params.db,
        grantedPermissions: params.grantedPermissions,
        userId: params.userId,
        workspaceId: params.workspaceId,
      },
      [params.topicId],
    );
  } catch (error) {
    if (params.hideExistence && error instanceof TRPCError && error.code === 'FORBIDDEN') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic comment resource not found' });
    }
    throw error;
  }
};
