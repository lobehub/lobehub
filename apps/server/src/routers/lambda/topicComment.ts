import type { TopicCommentItem as TopicCommentDTO } from '@lobechat/types';
import { pickNonEmptyString, toRecord } from '@lobechat/utils/object';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import type { TopicCommentActivityRecipient } from '@/business/server/topic-comment/notifyActivity';
import { notifyTopicCommentActivity } from '@/business/server/topic-comment/notifyActivity';
import { notifyTopicCommentModeration } from '@/business/server/topic-comment/notifyModeration';
import { wsProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { RbacModel } from '@/database/models/rbac';
import {
  TOPIC_COMMENT_MESSAGE_NOT_IN_TOPIC,
  TOPIC_COMMENT_PARENT_NOT_FOUND,
  TOPIC_COMMENT_REPLY_CANNOT_ANCHOR,
  TOPIC_COMMENT_REPLY_DEPTH_EXCEEDED,
  TOPIC_COMMENT_TOPIC_NOT_FOUND,
  TopicCommentModel,
} from '@/database/models/topicComment';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import { users, workspaceMembers } from '@/database/schemas';
import type { TopicCommentItem } from '@/database/schemas/topicComment';
import type { Transaction } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { publishResourceEvent } from '@/server/services/resourceEvents';
import { getWorkspaceScopedPermissionMatches } from '@/server/services/workspacePermission';
import { after } from '@/server/utils/scheduleAfterResponse';

import {
  assertCanUseMessageTargets,
  assertCanUseTopicTargets,
  assertCanViewTopicTargets,
  filterUserIdsByTopicViewAccess,
} from './_helpers/conversationResourceGuard';

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

const topicCommentProcedure = wsProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  // Lazily resolve active membership and RBAC grants once, then reuse the
  // request-local promise for action checks, target guards and enrichment.
  let permissionCodes: Promise<string[]> | undefined;
  const getTopicCommentPermissionCodes = () => {
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
      getTopicCommentPermissionCodes,
      topicCommentModel: new TopicCommentModel(ctx.serverDB, ctx.userId, ctx.workspaceId),
    },
  });
});

const forbidden = (): never => {
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient topic comment permission' });
};

const assertPermission = async (
  ctx: {
    getTopicCommentPermissionCodes: () => Promise<string[]>;
    serverDB: Parameters<typeof getWorkspaceScopedPermissionMatches>[0]['db'];
    userId: string;
    workspaceId: string;
  },
  action: 'TOPIC_COMMENT_CREATE' | 'TOPIC_COMMENT_READ' | 'TOPIC_COMMENT_UPDATE',
) => {
  const grantedPermissions = await ctx.getTopicCommentPermissionCodes();
  const matches = await getWorkspaceScopedPermissionMatches({
    action,
    db: ctx.serverDB,
    grantedPermissions,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
  if (!matches.hasAllScope && !matches.hasOwnerScope) forbidden();
  return grantedPermissions;
};

const canUseTopicCommentTargets = async (
  ctx: {
    getTopicCommentPermissionCodes: () => Promise<string[]>;
    serverDB: Parameters<typeof getWorkspaceScopedPermissionMatches>[0]['db'];
    userId: string;
    workspaceId: string;
  },
  topicIds: string[],
) => {
  try {
    await assertCanUseTopicTargets(
      {
        db: ctx.serverDB,
        grantedPermissions: await ctx.getTopicCommentPermissionCodes(),
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      },
      topicIds,
    );
    return true;
  } catch (error) {
    if (error instanceof TRPCError && error.code === 'FORBIDDEN') return false;
    throw error;
  }
};

const toNotFound = (error: unknown): never => {
  if (
    error instanceof Error &&
    [
      TOPIC_COMMENT_MESSAGE_NOT_IN_TOPIC,
      TOPIC_COMMENT_PARENT_NOT_FOUND,
      TOPIC_COMMENT_REPLY_CANNOT_ANCHOR,
      TOPIC_COMMENT_REPLY_DEPTH_EXCEEDED,
      TOPIC_COMMENT_TOPIC_NOT_FOUND,
    ].includes(error.message)
  )
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic comment resource not found' });
  throw error;
};

const enrich = async (
  ctx: {
    getTopicCommentPermissionCodes: () => Promise<string[]>;
    serverDB: Parameters<typeof getWorkspaceScopedPermissionMatches>[0]['db'];
    userId: string;
    workspaceId: string;
  },
  items: TopicCommentItem[],
  permissionOverride?: Awaited<ReturnType<typeof getViewerPermissions>>,
): Promise<TopicCommentDTO[]> => {
  const authorIds = [
    ...new Set(items.flatMap(({ authorUserId }) => (authorUserId ? [authorUserId] : []))),
  ];
  const topicIds = [...new Set(items.map(({ topicId }) => topicId))];
  const [profiles, memberships, permissions, canUseResource] = await Promise.all([
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
    permissionOverride ?? getViewerPermissions(ctx),
    canUseTopicCommentTargets(ctx, topicIds),
  ]);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const activeIds = new Set(memberships.map(({ userId }) => userId));
  const now = Date.now();

  return items.map((item) => {
    const profile = item.authorUserId ? profileById.get(item.authorUserId) : undefined;
    const own = item.authorUserId === ctx.userId;
    const moderated = Boolean(item.moderatedAt);
    const moderationUnexpired =
      moderated &&
      Boolean(item.moderationExpiresAt) &&
      new Date(item.moderationExpiresAt!).getTime() > now;
    const canViewModeratedContent = permissions.restore.hasAllScope && moderationUnexpired;
    // Concrete moderator identity is audit-only and must never cross this DTO boundary.
    const { moderatedByUserId: _moderatedByUserId, ...safeItem } = item;

    return {
      ...safeItem,
      author: profile
        ? { ...profile, status: activeIds.has(profile.id) ? 'active' : 'former' }
        : { avatar: null, fullName: null, id: null, status: 'deactivated', username: null },
      canDelete:
        !item.deletedAt &&
        !moderated &&
        canUseResource &&
        (permissions.delete.hasAllScope || (permissions.delete.hasOwnerScope && own)),
      canEdit:
        !item.deletedAt &&
        !moderated &&
        canUseResource &&
        own &&
        (permissions.update.hasAllScope || permissions.update.hasOwnerScope),
      canRestore:
        moderated && moderationUnexpired && canUseResource && permissions.restore.hasAllScope,
      content: moderated && !canViewModeratedContent ? '' : item.content,
      editorData: moderated && !canViewModeratedContent ? null : item.editorData,
      moderationIsOwn: moderated && own,
    } as TopicCommentDTO;
  });
};

const getViewerPermissions = async (ctx: {
  getTopicCommentPermissionCodes: () => Promise<string[]>;
  serverDB: Parameters<typeof getWorkspaceScopedPermissionMatches>[0]['db'];
  userId: string;
  workspaceId: string;
}) => {
  const grantedPermissions = await ctx.getTopicCommentPermissionCodes();
  const [update, remove, restore] = await Promise.all([
    getWorkspaceScopedPermissionMatches({
      action: 'TOPIC_COMMENT_UPDATE',
      db: ctx.serverDB,
      grantedPermissions,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    }),
    getWorkspaceScopedPermissionMatches({
      action: 'TOPIC_COMMENT_DELETE',
      db: ctx.serverDB,
      grantedPermissions,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    }),
    getWorkspaceScopedPermissionMatches({
      action: 'TOPIC_COMMENT_RESTORE',
      db: ctx.serverDB,
      grantedPermissions,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    }),
  ]);

  return { delete: remove, restore, update };
};

const recordModerationAudit = async (
  ctx: {
    serverDB: Parameters<typeof getWorkspaceScopedPermissionMatches>[0]['db'];
    userId: string;
    workspaceId: string;
  },
  action: 'resource.deleted' | 'resource.restored',
  commentId: string,
  trx?: Transaction,
) =>
  new WorkspaceAuditLogModel(ctx.serverDB).create(
    {
      action,
      metadata: { operation: 'topic_comment_moderation' },
      resourceId: commentId,
      resourceType: 'topic_comment',
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    },
    trx,
  );

const notifyModerationBestEffort = (params: Parameters<typeof notifyTopicCommentModeration>[0]) => {
  after(async () => {
    try {
      await notifyTopicCommentModeration(params);
    } catch (error) {
      console.error('[topic-comment] Failed to send moderation notification', error);
    }
  });
};

interface NotificationCtx {
  serverDB: Parameters<typeof getWorkspaceScopedPermissionMatches>[0]['db'];
  workspaceId: string;
}

/**
 * Recipients come from stored rows (topic owner, root author, mention targets),
 * which can outlive access: a cross-workspace transfer keeps comments whose
 * authors never joined the destination workspace, and membership alone says
 * nothing about a private agent's conversation. Re-authorize every recipient
 * against the current topic before any id reaches the delivery slot.
 */
const filterRecipientsByTopicAccess = async (
  ctx: NotificationCtx,
  topicId: string,
  recipients: TopicCommentActivityRecipient[],
): Promise<TopicCommentActivityRecipient[]> => {
  if (recipients.length === 0) return [];

  const accessibleUserIds = new Set(
    await filterUserIdsByTopicViewAccess(
      { db: ctx.serverDB, workspaceId: ctx.workspaceId },
      [topicId],
      recipients.map(({ userId }) => userId),
    ),
  );
  return recipients.filter(({ userId }) => accessibleUserIds.has(userId));
};

const notifyActivityBestEffort = (
  ctx: NotificationCtx,
  params: Parameters<typeof notifyTopicCommentActivity>[0],
) => {
  after(async () => {
    try {
      const recipients = await filterRecipientsByTopicAccess(
        ctx,
        params.topicId,
        params.recipients,
      );
      if (recipients.length === 0) return;

      await notifyTopicCommentActivity({ ...params, recipients });
    } catch (error) {
      console.error('[topic-comment] Failed to send activity notification', error);
    }
  });
};

const publishCommentsChanged = (
  ctx: { userId: string },
  topicId: string,
  options: { includeActor?: boolean } = {},
) => {
  after(() =>
    publishResourceEvent(
      { id: topicId, type: 'topic' },
      { actorId: options.includeActor === false ? '' : ctx.userId, type: 'topic.commentsChanged' },
    ),
  );
};

const extractMentionedUserIds = (editorData: unknown): string[] => {
  const root = toRecord(editorData)?.root;
  const pending: unknown[] = root === undefined ? [] : [root];
  const userIds = new Set<string>();

  while (pending.length > 0) {
    const node = toRecord(pending.pop());
    if (!node) continue;

    const metadata = toRecord(node.metadata);
    if (node.type === 'mention' && metadata?.type === 'member') {
      const userId = pickNonEmptyString(metadata.id);
      if (userId) userIds.add(userId);
    }

    if (Array.isArray(node.children)) pending.push(...node.children);
  }

  return [...userIds];
};

const validateMentionedUserIds = async (
  ctx: {
    serverDB: Parameters<typeof getWorkspaceScopedPermissionMatches>[0]['db'];
    userId: string;
    workspaceId: string;
  },
  editorData: unknown,
): Promise<string[]> => {
  const candidateIds = extractMentionedUserIds(editorData).filter((id) => id !== ctx.userId);
  if (candidateIds.length === 0) return [];

  const activeMemberships = await ctx.serverDB
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, ctx.workspaceId),
        inArray(workspaceMembers.userId, candidateIds),
        isNull(workspaceMembers.deletedAt),
      ),
    );
  const activeUserIds = new Set(activeMemberships.map(({ userId }) => userId));
  return candidateIds.filter((id) => activeUserIds.has(id));
};

export const topicCommentRouter = router({
  create: topicCommentProcedure
    .input(
      z.object({
        clientId: idSchema,
        content: contentSchema,
        editorData: editorDataSchema.optional(),
        messageId: idSchema.optional(),
        parentCommentId: idSchema.optional(),
        topicId: idSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const grantedPermissions = await assertPermission(ctx, 'TOPIC_COMMENT_CREATE');
      try {
        await Promise.all([
          assertCanUseTopicTargets(
            {
              db: ctx.serverDB,
              grantedPermissions,
              userId: ctx.userId,
              workspaceId: ctx.workspaceId,
            },
            [input.topicId],
          ),
          assertCanUseMessageTargets(
            {
              db: ctx.serverDB,
              grantedPermissions,
              userId: ctx.userId,
              workspaceId: ctx.workspaceId,
            },
            input.messageId ? [input.messageId] : [],
          ),
        ]);
        const mentionedUserIds = await validateMentionedUserIds(ctx, input.editorData);
        const result = await ctx.topicCommentModel.createWithMentions({
          ...input,
          mentionedUserIds,
        });

        if (!result.isDuplicate) {
          publishCommentsChanged(ctx, result.comment.topicId);
          const recipientsByUserId = new Map<string, TopicCommentActivityRecipient>();
          const conversationRecipients: TopicCommentActivityRecipient[] = input.parentCommentId
            ? result.parentAuthorUserId
              ? [{ kind: 'replied', userId: result.parentAuthorUserId }]
              : []
            : input.messageId
              ? result.messageOwnerUserId
                ? [{ kind: 'commentedOnMessage', userId: result.messageOwnerUserId }]
                : []
              : result.topicParticipantUserIds.map((userId) => ({ kind: 'commented', userId }));
          for (const recipient of conversationRecipients) {
            if (recipient.userId !== ctx.userId) {
              recipientsByUserId.set(recipient.userId, recipient);
            }
          }
          for (const userId of result.addedMentionUserIds) {
            recipientsByUserId.set(userId, { kind: 'mentioned', userId });
          }

          if (recipientsByUserId.size > 0) {
            notifyActivityBestEffort(ctx, {
              actorUserId: ctx.userId,
              commentId: result.comment.id,
              recipients: [...recipientsByUserId.values()],
              rootCommentId: result.comment.parentCommentId ?? result.comment.id,
              topicId: result.comment.topicId,
              workspaceId: ctx.workspaceId,
            });
          }
        }

        const [comment] = await enrich(ctx, [result.comment]);
        return { comment, isDuplicate: result.isDuplicate };
      } catch (error) {
        return toNotFound(error);
      }
    }),
  delete: topicCommentProcedure
    .input(z.object({ id: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const permissions = await getViewerPermissions(ctx);
      const permission = permissions.delete;
      if (!permission.hasAllScope && !permission.hasOwnerScope) forbidden();

      const current = await ctx.topicCommentModel.findById(input.id, {
        includeAllModerated: true,
      });
      if (!current || (!permission.hasAllScope && current.authorUserId !== ctx.userId))
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic comment not found' });
      const grantedPermissions = await ctx.getTopicCommentPermissionCodes();
      await assertCanUseTopicTargets(
        {
          db: ctx.serverDB,
          grantedPermissions,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        },
        [current.topicId],
      );

      if (permission.hasAllScope && current.authorUserId !== ctx.userId) {
        const result = await ctx.serverDB.transaction(async (trx) => {
          const result = await ctx.topicCommentModel.moderateRemove(input.id, undefined, trx);
          if (!result)
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic comment not found' });
          await recordModerationAudit(ctx, 'resource.deleted', result.comment.id, trx);
          return result;
        });
        if (result.comment.authorUserId) {
          notifyModerationBestEffort({
            authorUserId: result.comment.authorUserId,
            commentId: result.comment.id,
            event: 'removed',
            eventId: String(result.moderationExpiresAt.getTime()),
            rootCommentId: result.comment.parentCommentId ?? result.comment.id,
            topicId: result.comment.topicId,
            workspaceId: ctx.workspaceId,
          });
        }
        publishCommentsChanged(ctx, result.comment.topicId, { includeActor: false });
        return {
          comment: (await enrich(ctx, [result.comment], permissions))[0],
          mode: 'moderated' as const,
        };
      }

      const mode = await ctx.topicCommentModel.delete(input.id, {
        overrideAuthorScope: false,
      });
      if (!mode) throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic comment not found' });
      publishCommentsChanged(ctx, current.topicId);
      return { mode };
    }),
  get: topicCommentProcedure.input(z.object({ id: idSchema })).query(async ({ ctx, input }) => {
    const grantedPermissions = await assertPermission(ctx, 'TOPIC_COMMENT_READ');
    const permissions = await getViewerPermissions(ctx);
    const item = await ctx.topicCommentModel.findById(input.id, {
      includeAllModerated: permissions.restore.hasAllScope,
    });
    if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic comment not found' });
    await assertCanViewTopicTargets(
      {
        db: ctx.serverDB,
        grantedPermissions,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      },
      [item.topicId],
    );
    return (await enrich(ctx, [item], permissions))[0];
  }),
  listReplies: topicCommentProcedure
    .input(pageSchema.extend({ rootCommentId: idSchema }))
    .query(async ({ ctx, input }) => {
      const grantedPermissions = await assertPermission(ctx, 'TOPIC_COMMENT_READ');
      const permissions = await getViewerPermissions(ctx);
      const root = await ctx.topicCommentModel.findById(input.rootCommentId, {
        includeAllModerated: permissions.restore.hasAllScope,
      });
      if (!root) throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic comment not found' });
      await assertCanViewTopicTargets(
        {
          db: ctx.serverDB,
          grantedPermissions,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        },
        [root.topicId],
      );
      const page = await ctx.topicCommentModel.listReplies(input, {
        includeAllModerated: permissions.restore.hasAllScope,
      });
      return { ...page, items: await enrich(ctx, page.items, permissions) };
    }),
  listThreads: topicCommentProcedure
    .input(pageSchema.extend({ messageId: idSchema.optional(), topicId: idSchema }))
    .query(async ({ ctx, input }) => {
      const grantedPermissions = await assertPermission(ctx, 'TOPIC_COMMENT_READ');
      await assertCanViewTopicTargets(
        {
          db: ctx.serverDB,
          grantedPermissions,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        },
        [input.topicId],
      );
      const permissions = await getViewerPermissions(ctx);
      const page = await ctx.topicCommentModel.listThreads(input, {
        includeAllModerated: permissions.restore.hasAllScope,
      });
      const roots = await enrich(
        ctx,
        page.items.map(({ root }) => root),
        permissions,
      );
      return {
        ...page,
        items: page.items.map((thread, index) => ({ ...thread, root: roots[index] })),
      };
    }),
  restore: topicCommentProcedure
    .input(z.object({ id: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const permissions = await getViewerPermissions(ctx);
      if (!permissions.restore.hasAllScope) forbidden();

      const current = await ctx.topicCommentModel.findById(input.id, {
        includeAllModerated: true,
      });
      if (!current)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Recoverable topic comment not found' });
      const grantedPermissions = await ctx.getTopicCommentPermissionCodes();
      await assertCanUseTopicTargets(
        {
          db: ctx.serverDB,
          grantedPermissions,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        },
        [current.topicId],
      );
      if (!current.moderatedAt || !current.moderationExpiresAt)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Recoverable topic comment not found' });
      if (new Date(current.moderationExpiresAt).getTime() <= Date.now())
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Topic comment recovery window has expired',
        });

      const restored = await ctx.serverDB.transaction(async (trx) => {
        const restored = await ctx.topicCommentModel.restoreModerated(input.id, undefined, trx);
        if (!restored)
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Topic comment recovery state changed',
          });
        await recordModerationAudit(ctx, 'resource.restored', restored.id, trx);
        return restored;
      });
      if (restored.authorUserId) {
        notifyModerationBestEffort({
          authorUserId: restored.authorUserId,
          commentId: restored.id,
          event: 'restored',
          eventId: String(new Date(current.moderationExpiresAt).getTime()),
          rootCommentId: restored.parentCommentId ?? restored.id,
          topicId: restored.topicId,
          workspaceId: ctx.workspaceId,
        });
      }

      publishCommentsChanged(ctx, restored.topicId, { includeActor: false });

      return (await enrich(ctx, [restored], permissions))[0];
    }),
  summary: topicCommentProcedure
    .input(z.object({ topicId: idSchema }))
    .query(async ({ ctx, input }) => {
      const grantedPermissions = await assertPermission(ctx, 'TOPIC_COMMENT_READ');
      await assertCanViewTopicTargets(
        {
          db: ctx.serverDB,
          grantedPermissions,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        },
        [input.topicId],
      );
      return ctx.topicCommentModel.summary(input.topicId);
    }),
  update: topicCommentProcedure
    .input(
      z
        .object({
          content: contentSchema.optional(),
          editorData: editorDataSchema.optional(),
          id: idSchema,
        })
        .refine(({ content, editorData }) => content !== undefined || editorData !== undefined, {
          message: 'An update field is required',
        }),
    )
    .mutation(async ({ ctx, input: { id, ...input } }) => {
      const permissions = await getViewerPermissions(ctx);
      if (!permissions.update.hasAllScope && !permissions.update.hasOwnerScope) forbidden();
      const current = await ctx.topicCommentModel.findById(id);
      if (
        !current ||
        current.authorUserId !== ctx.userId ||
        current.deletedAt ||
        current.moderatedAt
      )
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic comment not found' });
      const grantedPermissions = await ctx.getTopicCommentPermissionCodes();
      await assertCanUseTopicTargets(
        {
          db: ctx.serverDB,
          grantedPermissions,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        },
        [current.topicId],
      );
      const mentionedUserIds =
        input.editorData === undefined
          ? undefined
          : await validateMentionedUserIds(ctx, input.editorData);
      const result = await ctx.topicCommentModel.update(id, input, { mentionedUserIds });
      if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic comment not found' });

      if (result.addedMentionUserIds.length > 0) {
        notifyActivityBestEffort(ctx, {
          actorUserId: ctx.userId,
          commentId: result.comment.id,
          recipients: result.addedMentionUserIds.map((userId) => ({
            kind: 'mentioned',
            userId,
          })),
          rootCommentId: result.comment.parentCommentId ?? result.comment.id,
          topicId: result.comment.topicId,
          workspaceId: ctx.workspaceId,
        });
      }

      publishCommentsChanged(ctx, result.comment.topicId);

      return (await enrich(ctx, [result.comment], permissions))[0];
    }),
});
