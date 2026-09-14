import { AGENT_SHARE_VISITOR_TOPIC_LIST_LIMIT } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getAgentShareMonthlySpend } from '@/business/server/agent-share/spendGate';
import { AgentShareModel } from '@/database/models/agentShare';
import { TopicModel } from '@/database/models/topic';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

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

const agentShareProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      agentShareModel: new AgentShareModel(ctx.serverDB, ctx.userId),
    },
  });
});

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
  disableShare: agentShareProcedure
    .input(agentIdInput)
    .mutation(async ({ input, ctx }) =>
      requireShare(await ctx.agentShareModel.updateVisibility(input.agentId, 'private')),
    ),

  enableShare: agentShareProcedure
    .input(agentIdInput.extend({ visibility: z.enum(['private', 'link']).optional() }).strict())
    .mutation(async ({ input, ctx }) => {
      await assertAgentShareCreationEnabled(ctx.userId);

      return ctx.agentShareModel.create(input.agentId, input.visibility);
    }),

  /**
   * Aggregate usage of one share, for its owner only — `getByAgentId` is
   * ownership-scoped, so a non-owner never gets past the NOT_FOUND below.
   *
   * Visitor counts come from `topics.senderId` (set for share-originated
   * topics only); `monthlySpend` comes from the billing business slot and is
   * `null` in deployments that do not meter share spend, which the UI renders
   * as "no spend data" rather than as zero.
   */
  getShareStats: agentShareProcedure.input(agentIdInput).query(async ({ input, ctx }) => {
    const share = requireShare(await ctx.agentShareModel.getByAgentId(input.agentId));

    const topicModel = new TopicModel(ctx.serverDB, ctx.userId);
    const [visitors, monthlySpend] = await Promise.all([
      topicModel.countShareVisitors({ agentId: input.agentId }),
      getAgentShareMonthlySpend({ agentId: input.agentId, ownerUserId: ctx.userId }),
    ]);

    return {
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

  getShareStatus: agentShareProcedure
    .input(agentIdInput)
    .query(async ({ input, ctx }) => ctx.agentShareModel.getByAgentId(input.agentId)),

  updateShareConfig: agentShareProcedure
    .input(
      z
        .object({
          agentId: z.string().trim().min(1),
          config: agentShareConfigPatchSchema,
        })
        .strict(),
    )
    .mutation(async ({ input, ctx }) =>
      requireShare(await ctx.agentShareModel.updateConfig(input.agentId, input.config)),
    ),

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
    .mutation(async ({ input, ctx }) =>
      requireShare(await ctx.agentShareModel.updateSlug(input.agentId, input.slug)),
    ),

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
