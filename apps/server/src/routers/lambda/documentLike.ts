import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import type { DocumentLikeActivityParams } from '@/business/server/document-like/notifyActivity';
import {
  notifyDocumentLiked,
  revokeDocumentLikeNotification,
} from '@/business/server/document-like/notifyActivity';
import { wsProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import {
  DOCUMENT_LIKE_DOCUMENT_NOT_FOUND,
  DocumentLikeModel,
} from '@/database/models/documentLike';
import { RbacModel } from '@/database/models/rbac';
import { workspaceMembers } from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { publishResourceEvent } from '@/server/services/resourceEvents';
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';
import { after } from '@/server/utils/scheduleAfterResponse';

const documentIdSchema = z.object({ documentId: z.string().trim().min(1).max(255) });

const documentLikeProcedure = wsProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  let permissionCodes: Promise<string[]> | undefined;
  const getPermissionCodes = () => {
    permissionCodes ??= Promise.all([
      ctx.serverDB
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, ctx.workspaceId),
            eq(workspaceMembers.userId, ctx.userId),
            isNull(workspaceMembers.deletedAt),
          ),
        )
        .limit(1),
      new RbacModel(ctx.serverDB, ctx.userId).getUserPermissions({ workspaceId: ctx.workspaceId }),
    ]).then(([membership, codes]) => (membership[0] ? codes : []));
    return permissionCodes;
  };

  return next({
    ctx: {
      documentLikeModel: new DocumentLikeModel(ctx.serverDB, ctx.userId, ctx.workspaceId),
      getDocumentLikePermissionCodes: getPermissionCodes,
    },
  });
});

interface LikeContext {
  getDocumentLikePermissionCodes: () => Promise<string[]>;
  serverDB: Parameters<typeof assertCanPerformResourceAction>[0]['db'];
  userId: string;
  workspaceId: string;
}

/**
 * Liking is a read-level social action: any active member who can view the
 * document may like it, so no dedicated RBAC code is consulted.
 */
const assertDocumentView = async (ctx: LikeContext, documentId: string) => {
  const grantedPermissions = await ctx.getDocumentLikePermissionCodes();
  if (grantedPermissions.length === 0) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Workspace membership required' });
  }
  await assertCanPerformResourceAction({
    action: 'view',
    db: ctx.serverDB,
    grantedPermissions,
    resourceId: documentId,
    resourceType: 'document',
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
};

const toNotFound = (error: unknown): never => {
  if (error instanceof Error && error.message === DOCUMENT_LIKE_DOCUMENT_NOT_FOUND) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
  }
  throw error;
};

const publishLikesChanged = (ctx: Pick<LikeContext, 'userId'>, documentId: string) => {
  after(() =>
    publishResourceEvent(
      { id: documentId, type: 'document' },
      { actorId: ctx.userId, type: 'document.likesChanged' },
    ),
  );
};

const runActivityBestEffort = (
  label: string,
  params: DocumentLikeActivityParams,
  run: (params: DocumentLikeActivityParams) => Promise<void>,
) => {
  if (params.recipientUserId === params.actorUserId) return;
  after(async () => {
    try {
      await run(params);
    } catch (error) {
      console.error(`[document-like] Failed to ${label}`, error);
    }
  });
};

export const documentLikeRouter = router({
  like: documentLikeProcedure.input(documentIdSchema).mutation(async ({ ctx, input }) => {
    await assertDocumentView(ctx, input.documentId);
    try {
      const result = await ctx.documentLikeModel.like(input.documentId);
      if (result.created) {
        runActivityBestEffort(
          'send like notification',
          {
            actorUserId: ctx.userId,
            documentId: input.documentId,
            recipientUserId: result.documentAuthorUserId,
            workspaceId: ctx.workspaceId,
          },
          notifyDocumentLiked,
        );
        publishLikesChanged(ctx, input.documentId);
      }
      return result.summary;
    } catch (error) {
      return toNotFound(error);
    }
  }),

  summary: documentLikeProcedure.input(documentIdSchema).query(async ({ ctx, input }) => {
    await assertDocumentView(ctx, input.documentId);
    try {
      return await ctx.documentLikeModel.summary(input.documentId);
    } catch (error) {
      return toNotFound(error);
    }
  }),

  unlike: documentLikeProcedure.input(documentIdSchema).mutation(async ({ ctx, input }) => {
    await assertDocumentView(ctx, input.documentId);
    try {
      const result = await ctx.documentLikeModel.unlike(input.documentId);
      if (result.removed) {
        runActivityBestEffort(
          'revoke like notification',
          {
            actorUserId: ctx.userId,
            documentId: input.documentId,
            recipientUserId: result.documentAuthorUserId,
            workspaceId: ctx.workspaceId,
          },
          revokeDocumentLikeNotification,
        );
        publishLikesChanged(ctx, input.documentId);
      }
      return result.summary;
    } catch (error) {
      return toNotFound(error);
    }
  }),
});
