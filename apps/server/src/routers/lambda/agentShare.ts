import { isHeterogeneousAgentConfig } from '@lobechat/const';
import { ChatErrorType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AgentModel } from '@/database/models/agent';
import { AgentShareModel } from '@/database/models/agentShare';
import { VISITOR_TOPIC_PAGE_SIZE } from '@/database/models/topic';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const agentIdInput = z.object({ agentId: z.string().trim().min(1) }).strict();

export const agentShareConfigSchema = z
  .object({
    allowReadMemory: z.boolean().optional(),
    enabledToolIds: z.array(z.string().trim().min(1)).optional(),
    filePermissionConfig: z
      .object({
        agentFiles: z.enum(['none', 'read']).optional(),
        knowledgeBase: z.enum(['none', 'read']).optional(),
        uploadAllowed: z.boolean().optional(),
      })
      .strict()
      .optional(),
    // Bounded by the visitor topic list page size (`TopicModel.queryBySender`),
    // which has no cursor: a higher cap would let a visitor create topics that
    // the list can never show again.
    maxTopicsPerVisitor: z.number().int().positive().max(VISITOR_TOPIC_PAGE_SIZE),
    maxTurnsPerTopic: z.number().int().positive(),
  })
  .strict();

export const agentShareConfigPatchSchema = agentShareConfigSchema
  .partial()
  .refine((config) => Object.keys(config).length > 0, 'Config patch cannot be empty');

const agentShareProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      agentModel: new AgentModel(ctx.serverDB, ctx.userId),
      agentShareModel: new AgentShareModel(ctx.serverDB, ctx.userId),
    },
  });
});

const requireShare = <T>(share: T | null): T => {
  if (!share) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent share not found' });
  }

  return share;
};

/**
 * Reject enabling/publishing a share for a heterogeneous (Claude Code / Codex /
 * …) agent. `AiAgentService.execAgent` fail-closes every visitor run against
 * such agents with `ShareHeterogeneousAgentUnsupported` (see
 * apps/server/src/services/aiAgent/index.ts), so a link that reaches this
 * state looks live in the owner's settings but breaks on the recipient's very
 * first message. Reusing the same classification the runtime uses — rather
 * than re-deriving it — keeps this gate and the execution gate from drifting
 * apart. Checked here (in the router, not `AgentShareModel`) so it composes
 * cleanly with that model's own hardening work happening in parallel.
 */
const assertShareableAgent = async (agentModel: AgentModel, agentId: string) => {
  const agent = await agentModel.getAgentConfigById(agentId);

  if (isHeterogeneousAgentConfig(agent)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: ChatErrorType.ShareHeterogeneousAgentUnsupported,
    });
  }
};

export const agentShareRouter = router({
  disableShare: agentShareProcedure.input(agentIdInput).mutation(async ({ input, ctx }) => {
    return requireShare(await ctx.agentShareModel.deleteByAgentId(input.agentId));
  }),

  enableShare: agentShareProcedure.input(agentIdInput).mutation(async ({ input, ctx }) => {
    await assertShareableAgent(ctx.agentModel, input.agentId);

    return ctx.agentShareModel.create(input.agentId);
  }),

  getShareStatus: agentShareProcedure.input(agentIdInput).query(async ({ input, ctx }) => {
    return ctx.agentShareModel.getByAgentId(input.agentId);
  }),

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
      return requireShare(await ctx.agentShareModel.updateConfig(input.agentId, input.config));
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
      // The authoritative heterogeneity check now lives in
      // `AgentShareModel.updateVisibility` itself, re-read from the Agent row
      // AFTER that model takes its row lock — see the JSDoc there for why a
      // pre-lock check here (the previous approach) could be bypassed by a
      // concurrent `AgentModel.updateConfig` write. Not duplicated here to
      // avoid the two checks drifting apart.
      return requireShare(
        await ctx.agentShareModel.updateVisibility(input.agentId, input.visibility),
      );
    }),
});

export type AgentShareConfigInput = z.infer<typeof agentShareConfigSchema>;
export type AgentShareConfigPatchInput = z.infer<typeof agentShareConfigPatchSchema>;
export type AgentShareRouter = typeof agentShareRouter;
