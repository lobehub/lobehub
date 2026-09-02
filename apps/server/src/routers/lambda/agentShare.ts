import { parseShareToolEntry } from '@lobechat/const';
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
 * One `enabledToolIds` entry — either a bare toolset identifier
 * (`lobe-agent`) or a per-API scoped grant (`lobe-agent____analyzeMedia`,
 * exactly one `PLUGIN_SCHEMA_SEPARATOR`). Validated with the same
 * {@link parseShareToolEntry} the runtime gates use to interpret a stored
 * entry, so a malformed value can never be persisted in the first place.
 */
const shareToolEntrySchema = z
  .string()
  .trim()
  .min(1)
  .refine((entry) => !!parseShareToolEntry(entry), {
    message: 'Expected a tool identifier or `identifier____apiName` entry',
  });

export const agentShareConfigSchema = z
  .object({
    allowCreatorViewSessions: z.boolean().optional(),
    allowReadMemory: z.boolean().optional(),
    // Deduped so repeated toggles/patches from the client never accumulate
    // duplicate entries in the persisted jsonb array.
    enabledToolIds: z
      .array(shareToolEntrySchema)
      .transform((ids) => Array.from(new Set(ids)))
      .optional(),
    maxTopicsPerVisitor: z.number().int().positive().optional(),
    maxTurnsPerTopic: z.number().int().positive().optional(),
    /** `null` clears the cap back to "unlimited" (removes the stored key). */
    monthlySpendLimit: z.number().nonnegative().nullable().optional(),
    showErrorDetails: z.boolean().optional(),
    showModelInfo: z.boolean().optional(),
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
      monthlySpendLimit: share.shareConfig.monthlySpendLimit ?? null,
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
