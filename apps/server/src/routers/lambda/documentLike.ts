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
import { documentLikes, workspaceMembers } from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { publishResourceEvent } from '@/server/services/resourceEvents';
import {
  assertCanPerformResourceAction,
  canPerformResourceAction,
  getResourceMeta,
} from '@/server/services/resourcePermission';
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

/**
 * A like notification carries the document title, so before dispatch the
 * recipient (the document author) must still be an active member who can view
 * the document — membership is soft-deleted and documents survive removal, so
 * a stale author id must not receive workspace content. Mirrors the
 * document-comment notification path.
 */
const canRecipientViewDocument = async (
  ctx: LikeContext,
  params: DocumentLikeActivityParams,
): Promise<boolean> => {
  const [meta, permissionsByUserId] = await Promise.all([
    getResourceMeta(ctx.serverDB, 'document', params.documentId),
    RbacModel.getWorkspaceUsersPermissions({
      db: ctx.serverDB,
      requireMembership: true,
      userIds: [params.recipientUserId],
      workspaceId: ctx.workspaceId,
    }),
  ]);
  if (!meta) return false;
  const grantedPermissions = permissionsByUserId.get(params.recipientUserId);
  if (!grantedPermissions) return false;

  return canPerformResourceAction({
    action: 'view',
    db: ctx.serverDB,
    effectiveAccessLevel: 'view',
    grantedPermissions,
    meta,
    resourceId: params.documentId,
    resourceType: 'document',
    userId: params.recipientUserId,
    workspaceId: ctx.workspaceId,
  });
};

const runActivityBestEffort = (
  ctx: LikeContext,
  label: string,
  params: DocumentLikeActivityParams,
  run: (params: DocumentLikeActivityParams) => Promise<void>,
  options: {
    /**
     * after() callbacks carry no cross-request ordering, so a rapid
     * like→unlike (or unlike→like) can execute this callback after the
     * opposite mutation already landed. Each callback therefore re-reads the
     * ground truth — whether the actor's like row currently exists — and only
     * acts when it matches this expectation, so the last mutation's outcome
     * always wins regardless of callback ordering.
     */
    expectLikeRow: boolean;
    /**
     * Withdrawing a notification is cleanup, not disclosure — it should reach
     * a removed author's inbox too, so revoke skips the access recheck.
     */
    skipRecipientAccessCheck?: boolean;
  },
) => {
  if (params.recipientUserId === params.actorUserId) return;
  after(async () => {
    try {
      const [likeRow] = await ctx.serverDB
        .select({ id: documentLikes.id })
        .from(documentLikes)
        .where(
          and(
            eq(documentLikes.documentId, params.documentId),
            eq(documentLikes.userId, params.actorUserId),
          ),
        )
        .limit(1);
      if (Boolean(likeRow) !== options.expectLikeRow) return;

      if (!options.skipRecipientAccessCheck && !(await canRecipientViewDocument(ctx, params))) {
        return;
      }
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
          ctx,
          'send like notification',
          {
            actorUserId: ctx.userId,
            documentId: input.documentId,
            recipientUserId: result.documentAuthorUserId,
            workspaceId: ctx.workspaceId,
          },
          notifyDocumentLiked,
          { expectLikeRow: true },
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
          ctx,
          'revoke like notification',
          {
            actorUserId: ctx.userId,
            documentId: input.documentId,
            recipientUserId: result.documentAuthorUserId,
            workspaceId: ctx.workspaceId,
          },
          revokeDocumentLikeNotification,
          { expectLikeRow: false, skipRecipientAccessCheck: true },
        );
        publishLikesChanged(ctx, input.documentId);
      }
      return result.summary;
    } catch (error) {
      return toNotFound(error);
    }
  }),
});
