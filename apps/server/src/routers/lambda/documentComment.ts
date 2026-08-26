import type { DocumentCommentItem as DocumentCommentDTO } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

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
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';
import { getWorkspaceScopedPermissionMatches } from '@/server/services/workspacePermission';

const MAX_EDITOR_DATA_BYTES = 128 * 1024;
const idSchema = z.string().trim().min(1).max(255);
const contentSchema = z.string().trim().min(1).max(10_000);
const editorDataSchema = z
  .json()
  .refine((value) => Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_EDITOR_DATA_BYTES, {
    message: 'editorData must not exceed 128 KiB',
  });
const pageSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

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
      z.object({
        clientId: idSchema,
        content: contentSchema,
        documentId: idSchema,
        editorData: editorDataSchema.optional(),
        parentCommentId: idSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { grantedPermissions } = await assertPermission(ctx, 'DOCUMENT_COMMENT_CREATE');
      await assertDocumentView(ctx, input.documentId, grantedPermissions);
      try {
        const result = await ctx.documentCommentModel.create(input);
        const [comment] = await enrich(ctx, [result.comment]);
        return { ...result, comment };
      } catch (error) {
        toNotFound(error);
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
      return { mode };
    }),

  get: documentCommentProcedure.input(z.object({ id: idSchema })).query(async ({ ctx, input }) => {
    const { grantedPermissions } = await assertPermission(ctx, 'DOCUMENT_COMMENT_READ');
    const comment = await ctx.documentCommentModel.findById(input.id);
    if (!comment) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Document comment not found' });
    }
    await assertDocumentView(ctx, comment.documentId, grantedPermissions);
    return (await enrich(ctx, [comment]))[0];
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
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const current = await ctx.documentCommentModel.findById(input.id);
      if (!current) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document comment not found' });
      }
      const { grantedPermissions } = await assertPermission(ctx, 'DOCUMENT_COMMENT_UPDATE');
      await assertDocumentView(ctx, current.documentId, grantedPermissions);
      const { id, ...updates } = input;
      const comment = await ctx.documentCommentModel.update(id, updates);
      if (!comment) throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot edit comment' });
      return (await enrich(ctx, [comment]))[0];
    }),
});
