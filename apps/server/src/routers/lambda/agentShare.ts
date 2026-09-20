import {
  AGENT_SHARE_DEFAULT_MAX_FILE_STORAGE,
  AGENT_SHARE_VISITOR_TOPIC_LIST_LIMIT,
} from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getAgentShareMonthlySpend } from '@/business/server/agent-share/spendGate';
import { withRbacPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentShareModel } from '@/database/models/agentShare';
import { FileModel } from '@/database/models/file';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';

import { assertAgentShareCreationEnabled } from './_helpers/agentShareFeatureGate';

const agentIdInput = z.object({ agentId: z.string().trim().min(1) }).strict();

/**
 * One `toolGrants` entry: a tool identifier, optionally narrowed to specific
 * API names. `apis` omitted grants every API the tool offers (still subject to
 * the runtime visitor gates); `apis` present grants only the named ones, and
 * is never empty — a tool with no granted API is simply absent from the list.
 * Duplicate API names within one entry are rejected rather than silently
 * deduped, so a client bug surfaces instead of persisting a redundant row.
 */
const shareToolGrantSchema = z
  .object({
    apis: z
      .array(z.string().trim().min(1))
      .min(1)
      .refine((apis) => new Set(apis).size === apis.length, {
        message: 'Duplicate api name in a tool grant',
      })
      .optional(),
    identifier: z.string().trim().min(1),
  })
  .strict();

export const agentShareConfigSchema = z
  .object({
    allowCreatorViewSessions: z.boolean().optional(),
    allowReadMemory: z.boolean().optional(),
    /** Bytes; `0` is a real value (attachments off), so non-negative rather than positive. */
    maxFileStorage: z.number().int().nonnegative().optional(),
    /**
     * The visitor topic list (`TopicModel.queryBySender`) is not paginated
     * and is bounded by `AGENT_SHARE_VISITOR_TOPIC_LIST_LIMIT`, so a cap
     * above that constant would let visitors create topics they can never
     * reopen.
     */
    maxTopicsPerVisitor: z
      .number()
      .int()
      .positive()
      .max(AGENT_SHARE_VISITOR_TOPIC_LIST_LIMIT)
      .optional(),
    maxTurnsPerTopic: z.number().int().positive().optional(),
    monthlySpendLimit: z.number().nonnegative().optional(),
    showErrorDetails: z.boolean().optional(),
    showModelInfo: z.boolean().optional(),
    /**
     * At most one entry per identifier: two entries for the same tool would
     * make the effective grant depend on the merge rule in
     * `resolveShareToolGrants` rather than on what the creator picked, so the
     * ambiguity is rejected at the door instead of silently resolved.
     */
    toolGrants: z
      .array(shareToolGrantSchema)
      .refine((grants) => new Set(grants.map((grant) => grant.identifier)).size === grants.length, {
        message: 'Duplicate tool identifier in toolGrants',
      })
      .optional(),
  })
  .strict();

export const agentShareConfigPatchSchema = agentShareConfigSchema.refine(
  (config) => Object.keys(config).length > 0,
  'Config patch cannot be empty',
);

const agentShareProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentShareModel: new AgentShareModel(ctx.serverDB, ctx.userId, workspaceId, {
        authorizeMutation: workspaceId
          ? (db, agentId) =>
              assertCanPerformResourceAction({
                action: 'manage',
                db,
                resourceId: agentId,
                resourceType: 'agent',
                userId: ctx.userId,
                workspaceId,
              })
          : undefined,
      }),
    },
  });
});

const workspaceAgentShareAdminProcedure = agentShareProcedure
  .use(withRbacPermission('agent:update:all'))
  .use(async (opts) => {
    if (!opts.ctx.workspaceId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Workspace context required' });
    }

    return opts.next({ ctx: { workspaceId: opts.ctx.workspaceId } });
  });

interface AgentSharePermissionContext {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
  workspacePermissionCodes?: string[];
}

/**
 * Workspace shares are authority over an Agent, not another General Access
 * grade: private Agents stay creator-only, while public Agents are manageable
 * by their creator or a Workspace admin with `agent:update:all`.
 */
const assertCanManageAgentShare = async (
  ctx: AgentSharePermissionContext,
  agentId: string,
): Promise<void> => {
  if (!ctx.workspaceId) return;

  await assertCanPerformResourceAction({
    action: 'manage',
    db: ctx.serverDB,
    grantedPermissions: ctx.workspacePermissionCodes,
    resourceId: agentId,
    resourceType: 'agent',
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
};

/** `updateConfig` / `updateVisibility` / `updateSlug` all return `null` when the share (or its owning agent) does not resolve for this caller. */
const requireShare = <T>(share: T | null): T => {
  if (!share) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent share not found' });
  }

  return share;
};

export const agentShareRouter = router({
  /**
   * Turning sharing OFF is a pause, not a revocation: the row (and with it the
   * share id and custom slug the owner handed out) is kept and only flipped to
   * `private`, so re-enabling later resolves the very same link. Visitors are
   * locked out in the meantime — `getSharedAgent` and the runtime's
   * `isRunStillAuthorized` both require `link`.
   */
  disableShare: agentShareProcedure.input(agentIdInput).mutation(async ({ input, ctx }) => {
    await assertCanManageAgentShare(ctx, input.agentId);
    return requireShare(await ctx.agentShareModel.updateVisibility(input.agentId, 'private'));
  }),

  enableShare: agentShareProcedure
    .input(agentIdInput.extend({ visibility: z.enum(['private', 'link']).optional() }).strict())
    .mutation(async ({ input, ctx }) => {
      await assertCanManageAgentShare(ctx, input.agentId);
      await assertAgentShareCreationEnabled(ctx.userId);

      return ctx.agentShareModel.create(input.agentId, input.visibility);
    }),

  /**
   * Minimal Workspace-wide audit inventory. `agent:update:all` is held by
   * administrators, while the model projection intentionally omits private
   * Agent configuration and visitor conversation content.
   */
  getWorkspaceShareAudit: workspaceAgentShareAdminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().nonnegative().default(0),
        })
        .strict(),
    )
    .query(({ input, ctx }) =>
      AgentShareModel.listWorkspaceSharesForAudit(ctx.serverDB, ctx.workspaceId, input),
    ),

  /**
   * Aggregate usage of one share, for its owner only — `getByAgentId` is
   * ownership-scoped, so a non-owner never gets past the NOT_FOUND below.
   *
   * Visitor counts come from `topics.senderId` (set for share-originated
   * topics only); `monthlySpend` comes from the billing business slot and is
   * `null` in deployments that do not meter share spend, which the UI renders
   * as "no spend data" rather than as zero. `fileStorageUsed` is the settled
   * bytes visitors have uploaded through this share — the same sum
   * `shareChat.createUploadUrl` holds against `maxFileStorage` (minus
   * in-flight reservations, which are transient) — so the owner can see how
   * close the share is to its cap, including drafts visitors never sent.
   */
  getShareStats: agentShareProcedure.input(agentIdInput).query(async ({ input, ctx }) => {
    await assertCanManageAgentShare(ctx, input.agentId);
    const share = requireShare(await ctx.agentShareModel.getByAgentId(input.agentId));
    const resolvedShare = requireShare(await AgentShareModel.findByShareId(ctx.serverDB, share.id));

    const topicModel = new TopicModel(
      ctx.serverDB,
      resolvedShare.ownerId,
      resolvedShare.workspaceId ?? undefined,
    );
    const fileModel = new FileModel(
      ctx.serverDB,
      resolvedShare.ownerId,
      resolvedShare.workspaceId ?? undefined,
    );
    const [visitors, monthlySpend, fileStorageUsed] = await Promise.all([
      topicModel.countShareVisitors({ shareId: share.id }),
      getAgentShareMonthlySpend({
        agentId: input.agentId,
        ownerUserId: resolvedShare.ownerId,
        shareId: share.id,
        workspaceId: resolvedShare.workspaceId ?? undefined,
      }),
      fileModel.countAgentShareUsage(share.id),
    ]);

    return {
      fileStorageUsed,
      maxFileStorage: share.shareConfig.maxFileStorage ?? AGENT_SHARE_DEFAULT_MAX_FILE_STORAGE,
      monthlySpend,
      monthlySpendLimit: share.shareConfig.monthlySpendLimit,
      topicCount: visitors.topicCount,
      // Raw page-view count (`agentShares.userViewCount`): bumped on every
      // non-owner page load, NOT deduplicated by visitor — a repeat visitor
      // inflates this every reload. For unique visitors, use `visitorCount`
      // below (distinct `topics.senderId` via `countShareVisitors`).
      userViewCount: share.userViewCount,
      visitorCount: visitors.visitorCount,
    };
  }),

  getShareStatus: agentShareProcedure.input(agentIdInput).query(async ({ input, ctx }) => {
    await assertCanManageAgentShare(ctx, input.agentId);
    return ctx.agentShareModel.getByAgentId(input.agentId);
  }),

  /**
   * Administrator emergency stop for any share in the active Workspace,
   * including private Agents the administrator cannot otherwise configure.
   */
  forceDisableWorkspaceShare: workspaceAgentShareAdminProcedure
    .input(z.object({ shareId: z.string().uuid() }).strict())
    .mutation(async ({ input, ctx }) =>
      requireShare(
        await AgentShareModel.forceDisableWorkspaceShare(
          ctx.serverDB,
          ctx.workspaceId,
          input.shareId,
        ),
      ),
    ),

  updateShareConfig: agentShareProcedure
    .input(
      z
        .object({
          agentId: z.string().trim().min(1),
          config: agentShareConfigPatchSchema,
        })
        .strict(),
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanManageAgentShare(ctx, input.agentId);
      return requireShare(await ctx.agentShareModel.updateConfig(input.agentId, input.config));
    }),

  /**
   * Custom URL slug for this share's public link. Pattern/reserved-word
   * validation runs again inside `AgentShareModel.updateSlug` — this router
   * check exists only to fail obviously-malformed input as `BAD_REQUEST`
   * before it reaches the ownership-locking transaction. `slug: null` clears
   * the custom slug.
   */
  updateSlug: agentShareProcedure
    .input(
      z
        .object({
          agentId: z.string().trim().min(1),
          slug: z.string().trim().toLowerCase().min(3).max(64).nullable(),
        })
        .strict(),
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanManageAgentShare(ctx, input.agentId);
      return requireShare(await ctx.agentShareModel.updateSlug(input.agentId, input.slug));
    }),

  updateVisibility: agentShareProcedure
    .input(
      z
        .object({
          agentId: z.string().trim().min(1),
          visibility: z.enum(['private', 'link']),
        })
        .strict(),
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanManageAgentShare(ctx, input.agentId);
      // Flipping to `link` publishes the share, so it is the same capability
      // as `enableShare`; going back to `private` unpublishes and stays open.
      if (input.visibility === 'link') await assertAgentShareCreationEnabled(ctx.userId);

      return requireShare(
        await ctx.agentShareModel.updateVisibility(input.agentId, input.visibility),
      );
    }),
});

export type AgentShareConfigInput = z.infer<typeof agentShareConfigSchema>;
export type AgentShareConfigPatchInput = z.infer<typeof agentShareConfigPatchSchema>;
export type AgentShareRouter = typeof agentShareRouter;
