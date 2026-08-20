import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AgentShareModel } from '@/database/models/agentShare';
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
    maxTopicsPerVisitor: z.number().int().positive(),
    maxTurnsPerTopic: z.number().int().positive(),
  })
  .strict();

const agentShareProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
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

export const agentShareRouter = router({
  disableShare: agentShareProcedure.input(agentIdInput).mutation(async ({ input, ctx }) => {
    return requireShare(await ctx.agentShareModel.deleteByAgentId(input.agentId));
  }),

  enableShare: agentShareProcedure.input(agentIdInput).mutation(async ({ input, ctx }) => {
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
          config: agentShareConfigSchema,
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
      return requireShare(
        await ctx.agentShareModel.updateVisibility(input.agentId, input.visibility),
      );
    }),
});

export type AgentShareConfigInput = z.infer<typeof agentShareConfigSchema>;
export type AgentShareRouter = typeof agentShareRouter;
