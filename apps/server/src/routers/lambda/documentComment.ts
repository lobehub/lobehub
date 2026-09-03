import type {
  DocumentCommentDetail,
  DocumentCommentItem as DocumentCommentDTO,
} from '@lobechat/types';
import { toRecord } from '@lobechat/utils/object';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import type { NotifyDocumentCommentActivityParams } from '@/business/server/document-comment/notifyActivity';
import { notifyDocumentCommentActivity } from '@/business/server/document-comment/notifyActivity';
import { wsProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import {
  DOCUMENT_COMMENT_DOCUMENT_NOT_FOUND,
  DOCUMENT_COMMENT_PARENT_NOT_FOUND,
  DocumentCommentModel,
} from '@/database/models/documentComment';
import { RbacModel } from '@/database/models/rbac';
import { documentComments, users, workspaceMembers } from '@/database/schemas';
import type { DocumentCommentItem } from '@/database/schemas/documentComment';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { publishResourceEvent } from '@/server/services/resourceEvents';
import {
  assertCanPerformResourceAction,
  canPerformResourceAction,
  getResourceMeta,
} from '@/server/services/resourcePermission';
import { getWorkspaceScopedPermissionMatches } from '@/server/services/workspacePermission';
import { validateMentionedUserIds as validateCommentMentionedUserIds } from '@/server/utils/commentMentions';
import { after } from '@/server/utils/scheduleAfterResponse';

const MAX_EDITOR_DATA_BYTES = 128 * 1024;
const idSchema = z.string().trim().min(1).max(255);
const contentSchema = z.string().trim().max(10_000);
const editorDataSchema = z
  .json()
  .refine((value) => Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_EDITOR_DATA_BYTES, {
    message: 'editorData must not exceed 128 KiB',
  });
const pageSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const getAttachmentState = (editorData: unknown) => {
  const root = toRecord(editorData)?.root;
  const pending: unknown[] = root === undefined ? [] : [root];
  let hasCompletedAttachments = false;
  let hasIncompleteAttachments = false;

  while (pending.length > 0) {
    const node = toRecord(pending.pop());
    if (!node) continue;

    const isFile = node.type === 'file';
    const isImage = node.type === 'image' || node.type === 'block-image';
    if (isFile || isImage) {
      const url = isFile ? node.fileUrl : node.src;
      if (node.status === 'uploaded' && typeof url === 'string' && url.length > 0) {
        hasCompletedAttachments = true;
      } else {
        hasIncompleteAttachments = true;
      }
    }

    if (Array.isArray(node.children)) pending.push(...node.children);
  }

  return { hasCompletedAttachments, hasIncompleteAttachments };
};

const validateCommentBody = (
  value: { content?: string; editorData?: unknown },
  ctx: z.RefinementCtx,
) => {
  const attachmentState = getAttachmentState(value.editorData);
  if (attachmentState.hasIncompleteAttachments) {
    ctx.addIssue({
      code: 'custom',
      message: 'Attachments must finish uploading successfully',
      path: ['editorData'],
    });
  }
  if (value.content !== undefined && !value.content && !attachmentState.hasCompletedAttachments) {
    ctx.addIssue({
      code: 'custom',
      message: 'Comment content or a completed attachment is required',
      path: ['content'],
    });
  }
};

const documentCommentProcedure = wsProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
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
      documentCommentModel: new DocumentCommentModel(ctx.serverDB, ctx.userId, ctx.workspaceId),
      getDocumentCommentPermissionCodes: getPermissionCodes,
    },
  });
});

interface PermissionContext {
  getDocumentCommentPermissionCodes: () => Promise<string[]>;
  serverDB: Parameters<typeof getWorkspaceScopedPermissionMatches>[0]['db'];
  userId: string;
  workspaceId: string;
}

type DocumentCommentAction =
  | 'DOCUMENT_COMMENT_CREATE'
  | 'DOCUMENT_COMMENT_DELETE'
  | 'DOCUMENT_COMMENT_READ'
  | 'DOCUMENT_COMMENT_UPDATE';

const assertPermission = async (ctx: PermissionContext, action: DocumentCommentAction) => {
  const grantedPermissions = await ctx.getDocumentCommentPermissionCodes();
  const matches = await getWorkspaceScopedPermissionMatches({
    action,
    db: ctx.serverDB,
    grantedPermissions,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
  if (!matches.hasAllScope && !matches.hasOwnerScope) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Insufficient document comment permission',
    });
  }
  return { grantedPermissions, matches };
};

const assertDocumentView = async (
  ctx: PermissionContext,
  documentId: string,
  grantedPermissions: readonly string[],
) =>
  assertCanPerformResourceAction({
    action: 'view',
    db: ctx.serverDB,
    grantedPermissions,
    resourceId: documentId,
    resourceType: 'document',
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });

const validateMentionedUserIds = (ctx: PermissionContext, editorData: unknown) =>
  validateCommentMentionedUserIds(
    ctx.serverDB,
    { actorUserId: ctx.userId, workspaceId: ctx.workspaceId },
    editorData,
  );

const notifyActivitiesBestEffort = (
  ctx: PermissionContext,
  activities: NotifyDocumentCommentActivityParams[],
) => {
  const pending = activities.filter(({ recipientUserId }) => recipientUserId !== ctx.userId);
  if (pending.length === 0) return;

  after(async () => {
    try {
      const documentId = pending[0].documentId;
      const recipientUserIds = [...new Set(pending.map(({ recipientUserId }) => recipientUserId))];
      const [meta, permissionsByUserId] = await Promise.all([
        getResourceMeta(ctx.serverDB, 'document', documentId),
        RbacModel.getWorkspaceUsersPermissions({
          db: ctx.serverDB,
          requireMembership: true,
          userIds: recipientUserIds,
          workspaceId: ctx.workspaceId,
        }),
      ]);
      if (!meta) return;

      const accessibleUserIds = new Set(
        (
          await Promise.all(
            recipientUserIds.map(async (userId) => {
              const grantedPermissions = permissionsByUserId.get(userId);
              if (!grantedPermissions) return null;

              const canView = await canPerformResourceAction({
                action: 'view',
                db: ctx.serverDB,
                effectiveAccessLevel: 'view',
                grantedPermissions,
                meta,
                resourceId: documentId,
                resourceType: 'document',
                userId,
                workspaceId: ctx.workspaceId,
              });
              return canView ? userId : null;
            }),
          )
        ).filter((userId): userId is string => Boolean(userId)),
      );

      await Promise.all(
        pending
          .filter(({ recipientUserId }) => accessibleUserIds.has(recipientUserId))
          .map((params) => notifyDocumentCommentActivity(params)),
      );
    } catch (error) {
      console.error('[document-comment] Failed to send activity notification', error);
    }
  });
};

const publishCommentsChanged = (
  ctx: Pick<PermissionContext, 'userId'>,
  documentId: string,
  rootCommentId: string,
) => {
  after(() =>
    publishResourceEvent(
      { id: documentId, type: 'document' },
      {
        actorId: ctx.userId,
        data: { rootCommentId },
        type: 'document.commentsChanged',
      },
    ),
  );
};

const toNotFound = (error: unknown): never => {
  if (
    error instanceof Error &&
    [DOCUMENT_COMMENT_DOCUMENT_NOT_FOUND, DOCUMENT_COMMENT_PARENT_NOT_FOUND].includes(error.message)
  ) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Document comment resource not found' });
  }
  throw error;
};

const getMutationPermissions = async (ctx: PermissionContext) => {
  const grantedPermissions = await ctx.getDocumentCommentPermissionCodes();
  const [update, remove] = await Promise.all([
    getWorkspaceScopedPermissionMatches({
      action: 'DOCUMENT_COMMENT_UPDATE',
      db: ctx.serverDB,
      grantedPermissions,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    }),
    getWorkspaceScopedPermissionMatches({
      action: 'DOCUMENT_COMMENT_DELETE',
      db: ctx.serverDB,
      grantedPermissions,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    }),
  ]);
  return { delete: remove, update };
};

const enrich = async (
  ctx: PermissionContext,
  items: DocumentCommentItem[],
): Promise<DocumentCommentDTO[]> => {
  const replyToIds = [
    ...new Set(
      items.flatMap(({ replyToCommentId }) => (replyToCommentId ? [replyToCommentId] : [])),
    ),
  ];
  const [replyTargets, permissions] = await Promise.all([
    replyToIds.length
      ? ctx.serverDB
          .select({ authorUserId: documentComments.authorUserId, id: documentComments.id })
          .from(documentComments)
          .where(inArray(documentComments.id, replyToIds))
      : [],
    getMutationPermissions(ctx),
  ]);
  const authorIds = [
    ...new Set(
      [...items, ...replyTargets].flatMap(({ authorUserId }) =>
        authorUserId ? [authorUserId] : [],
      ),
    ),
  ];
  const [profiles, memberships] = await Promise.all([
    authorIds.length
      ? ctx.serverDB
          .select({
            avatar: users.avatar,
            fullName: users.fullName,
            id: users.id,
            username: users.username,
          })
          .from(users)
          .where(inArray(users.id, authorIds))
      : [],
    authorIds.length
      ? ctx.serverDB
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, ctx.workspaceId),
              inArray(workspaceMembers.userId, authorIds),
              isNull(workspaceMembers.deletedAt),
            ),
          )
      : [],
  ]);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const activeIds = new Set(memberships.map(({ userId }) => userId));
  const replyTargetById = new Map(replyTargets.map((target) => [target.id, target]));
  const getAuthor = (authorUserId: string | null) => {
    const profile = authorUserId ? profileById.get(authorUserId) : undefined;
    return profile
      ? {
          ...profile,
          status: activeIds.has(profile.id) ? ('active' as const) : ('former' as const),
        }
      : {
          avatar: null,
          fullName: null,
          id: null,
          status: 'deactivated' as const,
          username: null,
        };
  };

  return items.map((item) => {
    const own = item.authorUserId === ctx.userId;
    const replyTarget = item.replyToCommentId
      ? replyTargetById.get(item.replyToCommentId)
      : undefined;
    return {
      ...item,
      author: getAuthor(item.authorUserId),
      canDelete:
        !item.deletedAt &&
        (permissions.delete.hasAllScope || (permissions.delete.hasOwnerScope && own)),
      canEdit:
        !item.deletedAt &&
        own &&
        (permissions.update.hasAllScope || permissions.update.hasOwnerScope),
      replyTo: replyTarget
        ? { author: getAuthor(replyTarget.authorUserId), id: replyTarget.id }
        : null,
    } as DocumentCommentDTO;
  });
};

export const documentCommentRouter = router({
  create: documentCommentProcedure
    .input(
      z
        .object({
          clientId: idSchema,
          content: contentSchema,
          documentId: idSchema,
          editorData: editorDataSchema.optional(),
          parentCommentId: idSchema.optional(),
        })
        .superRefine(validateCommentBody),
    )
    .mutation(async ({ ctx, input }) => {
      const { grantedPermissions } = await assertPermission(ctx, 'DOCUMENT_COMMENT_CREATE');
      await assertDocumentView(ctx, input.documentId, grantedPermissions);
      try {
        const mentionedUserIds = await validateMentionedUserIds(ctx, input.editorData);
        const result = await ctx.documentCommentModel.create({ ...input, mentionedUserIds });
        if (!result.isDuplicate) {
          // Later entries win, so the order encodes precedence:
          // thread participant < direct target / document author < mention.
          const recipientsByUserId = new Map<string, NotifyDocumentCommentActivityParams['kind']>();
          if (input.parentCommentId) {
            for (const userId of result.threadParticipantUserIds) {
              recipientsByUserId.set(userId, 'thread');
            }
            if (result.parentAuthorUserId) {
              recipientsByUserId.set(result.parentAuthorUserId, 'replied');
            }
          } else if (result.documentAuthorUserId) {
            recipientsByUserId.set(result.documentAuthorUserId, 'commented');
          }
          for (const userId of result.addedMentionUserIds) {
            recipientsByUserId.set(userId, 'mentioned');
          }
          recipientsByUserId.delete(ctx.userId);

          notifyActivitiesBestEffort(
            ctx,
            [...recipientsByUserId].map(([recipientUserId, kind]) => ({
              actorUserId: ctx.userId,
              commentId: result.comment.id,
              documentId: result.comment.documentId,
              kind,
              recipientUserId,
              rootCommentId: result.comment.parentCommentId ?? result.comment.id,
              workspaceId: ctx.workspaceId,
            })),
          );
          publishCommentsChanged(
            ctx,
            result.comment.documentId,
            result.comment.parentCommentId ?? result.comment.id,
          );
        }
        const [comment] = await enrich(ctx, [result.comment]);
        return { comment, isDuplicate: result.isDuplicate };
      } catch (error) {
        return toNotFound(error);
      }
    }),

  delete: documentCommentProcedure
    .input(z.object({ id: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const current = await ctx.documentCommentModel.findById(input.id);
      if (!current) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document comment not found' });
      }
      const { grantedPermissions, matches } = await assertPermission(
        ctx,
        'DOCUMENT_COMMENT_DELETE',
      );
      await assertDocumentView(ctx, current.documentId, grantedPermissions);
      const mode = await ctx.documentCommentModel.delete(input.id, {
        overrideAuthorScope: matches.hasAllScope,
      });
      if (!mode) throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot delete comment' });
      publishCommentsChanged(ctx, current.documentId, current.parentCommentId ?? current.id);
      return { mode };
    }),

  get: documentCommentProcedure.input(z.object({ id: idSchema })).query(async ({ ctx, input }) => {
    const { grantedPermissions } = await assertPermission(ctx, 'DOCUMENT_COMMENT_READ');
    const comment = await ctx.documentCommentModel.findById(input.id);
    if (!comment) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Document comment not found' });
    }
    await assertDocumentView(ctx, comment.documentId, grantedPermissions);
    // Roots carry their live reply count so a deep link can render the thread on its own.
    const [enriched, replyCount] = await Promise.all([
      enrich(ctx, [comment]),
      comment.parentCommentId ? 0 : ctx.documentCommentModel.countLiveReplies(comment.id),
    ]);
    return { ...enriched[0], replyCount } satisfies DocumentCommentDetail;
  }),

  listReplies: documentCommentProcedure
    .input(pageSchema.extend({ rootCommentId: idSchema }))
    .query(async ({ ctx, input }) => {
      const { grantedPermissions } = await assertPermission(ctx, 'DOCUMENT_COMMENT_READ');
      const root = await ctx.documentCommentModel.findById(input.rootCommentId);
      if (!root || root.parentCommentId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document comment thread not found' });
      }
      await assertDocumentView(ctx, root.documentId, grantedPermissions);
      const page = await ctx.documentCommentModel.listReplies(input);
      return { ...page, items: await enrich(ctx, page.items) };
    }),

  listThreads: documentCommentProcedure
    .input(pageSchema.extend({ documentId: idSchema }))
    .query(async ({ ctx, input }) => {
      const { grantedPermissions } = await assertPermission(ctx, 'DOCUMENT_COMMENT_READ');
      await assertDocumentView(ctx, input.documentId, grantedPermissions);
      const page = await ctx.documentCommentModel.listThreads(input);
      const roots = await enrich(
        ctx,
        page.items.map(({ root }) => root),
      );
      return {
        ...page,
        items: page.items.map((thread, index) => ({ ...thread, root: roots[index] })),
      };
    }),

  summary: documentCommentProcedure
    .input(z.object({ documentId: idSchema }))
    .query(async ({ ctx, input }) => {
      const { grantedPermissions } = await assertPermission(ctx, 'DOCUMENT_COMMENT_READ');
      await assertDocumentView(ctx, input.documentId, grantedPermissions);
      return ctx.documentCommentModel.summary(input.documentId);
    }),

  update: documentCommentProcedure
    .input(
      z
        .object({
          content: contentSchema.optional(),
          editorData: editorDataSchema.optional(),
          id: idSchema,
        })
        .refine((value) => value.content !== undefined || value.editorData !== undefined, {
          message: 'At least one field must be provided',
        })
        .superRefine(validateCommentBody),
    )
    .mutation(async ({ ctx, input }) => {
      const current = await ctx.documentCommentModel.findById(input.id);
      if (!current) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document comment not found' });
      }
      const { grantedPermissions } = await assertPermission(ctx, 'DOCUMENT_COMMENT_UPDATE');
      await assertDocumentView(ctx, current.documentId, grantedPermissions);
      const { id, ...updates } = input;
      const nextMentionedUserIds =
        input.editorData === undefined
          ? undefined
          : await validateMentionedUserIds(ctx, input.editorData);
      const result = await ctx.documentCommentModel.update(id, updates, {
        mentionedUserIds: nextMentionedUserIds,
      });
      if (!result) throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot edit comment' });

      notifyActivitiesBestEffort(
        ctx,
        result.addedMentionUserIds.map((recipientUserId) => ({
          actorUserId: ctx.userId,
          commentId: result.comment.id,
          documentId: result.comment.documentId,
          kind: 'mentioned',
          recipientUserId,
          rootCommentId: result.comment.parentCommentId ?? result.comment.id,
          workspaceId: ctx.workspaceId,
        })),
      );
      publishCommentsChanged(
        ctx,
        result.comment.documentId,
        result.comment.parentCommentId ?? result.comment.id,
      );
      return (await enrich(ctx, [result.comment]))[0];
    }),
});
