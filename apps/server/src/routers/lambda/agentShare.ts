import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AgentShareModel } from '@/database/models/agentShare';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const agentIdInput = z.object({ agentId: z.string().trim().min(1) }).strict();

export const agentShareConfigSchema = z
  .object({
    allowCreatorViewSessions: z.boolean().optional(),
    allowReadMemory: z.boolean().optional(),
    enabledToolIds: z.array(z.string().trim().min(1)).optional(),
    maxTopicsPerVisitor: z.number().int().positive().optional(),
    maxTurnsPerTopic: z.number().int().positive().optional(),
    monthlySpendLimit: z.number().nonnegative().optional(),
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

/** `updateConfig` / `updateVisibility` / `deleteByAgentId` / `updateSlug` all return `null` when the share (or its owning agent) does not resolve for this caller. */
const requireShare = <T>(share: T | null): T => {
  if (!share) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent share not found' });
  }

  return share;
};

export const agentShareRouter = router({
  disableShare: agentShareProcedure
    .input(agentIdInput)
    .mutation(async ({ input, ctx }) =>
      requireShare(await ctx.agentShareModel.deleteByAgentId(input.agentId)),
    ),

  enableShare: agentShareProcedure
    .input(agentIdInput.extend({ visibility: z.enum(['private', 'link']).optional() }).strict())
    .mutation(async ({ input, ctx }) =>
      ctx.agentShareModel.create(input.agentId, input.visibility),
    ),

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
   * before it reaches the ownership-locking transaction.
   */
  updateSlug: agentShareProcedure
    .input(
      z
        .object({
          agentId: z.string().trim().min(1),
          slug: z.string().trim().toLowerCase().min(3).max(64),
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
    .mutation(async ({ input, ctx }) =>
      requireShare(await ctx.agentShareModel.updateVisibility(input.agentId, input.visibility)),
    ),
});

export type AgentShareConfigInput = z.infer<typeof agentShareConfigSchema>;
export type AgentShareConfigPatchInput = z.infer<typeof agentShareConfigPatchSchema>;
export type AgentShareRouter = typeof agentShareRouter;
