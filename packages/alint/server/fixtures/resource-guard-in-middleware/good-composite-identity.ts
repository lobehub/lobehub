import { TRPCError } from '@trpc/server';
import pMap from 'p-map';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';

import { assertCanUseWorkspaceAgent } from './guards';
import { aiAgentProcedure } from './procedures';

const identity = { agentId: z.string().optional(), slug: z.string().optional() };

export const execRouter = router({
  execAgent: aiAgentProcedure
    .input(z.object({ ...identity, groupId: z.string().optional(), prompt: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { agentId, groupId, slug } = input;
      await assertCanUseWorkspaceAgent({
        agentId,
        db: ctx.serverDB,
        groupId,
        slug,
        userId: ctx.userId,
      });
      return ctx.aiAgentService.exec(input);
    }),
  scheduleAgentRun: aiAgentProcedure
    .input(z.object({ ...identity, runAt: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanUseWorkspaceAgent({
        agentId: input.agentId,
        db: ctx.serverDB,
        slug: input.slug,
        userId: ctx.userId,
      });
      return ctx.aiAgentService.schedule(input);
    }),
  execGroupAgent: aiAgentProcedure
    .input(z.object({ agentId: z.string(), groupId: z.string(), message: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanUseWorkspaceAgent({
        agentId: input.agentId,
        db: ctx.serverDB,
        groupId: input.groupId,
        userId: ctx.userId,
      });
      return ctx.aiAgentService.execGroup(input);
    }),
  execSubAgents: aiAgentProcedure
    .input(z.object({ tasks: z.array(z.object({ ...identity, prompt: z.string() })) }))
    .mutation(async ({ ctx, input }) => {
      if (input.tasks.length === 0) throw new TRPCError({ code: 'BAD_REQUEST' });
      return pMap(
        input.tasks,
        async (task) => {
          await assertCanUseWorkspaceAgent({ ...task, db: ctx.serverDB, userId: ctx.userId });
          return ctx.aiAgentService.exec(task);
        },
        { concurrency: 4 },
      );
    }),
});
