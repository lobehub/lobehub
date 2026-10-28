import { CreateAgentSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentService } from '@/server/services/agent';
import { resolveAgentReference } from '@/server/services/agent/resolveReference';

import { assertCanUseConversationTargets } from './_helpers/conversationResourceGuard';

const sessionProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentModel: new AgentModel(ctx.serverDB, ctx.userId, wsId),
      agentService: new AgentService(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

/** Native Session compatibility adapters. New clients should use the Agent router. */
export const sessionRouter = router({
  /** Native compatibility adapter: keep the Session envelope, create only an Agent. */
  createSession: sessionProcedure
    .use(withScopedPermission('agent:create'))
    .input(
      z.object({
        // Zod strips redundant fields in full default Session configs. This is
        // a user-configurable whitelist, never a database insert permission.
        config: CreateAgentSchema.extend({
          examples: z.unknown().optional(),
          identifier: z.string().optional(),
        }),
        session: z.object({
          groupId: z.string().nullish(),
          pinned: z.boolean().optional(),
        }),
        type: z.enum(['agent', 'group']),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (input.type !== 'agent') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Use agentGroup to create a group' });
      }
      const { examples, identifier, ...config } = input.config;
      const groupId = input.session.groupId ?? config.sessionGroupId;
      const { agentId } = await ctx.agentService.createAgent({
        config: {
          ...config,
          fewShots: config.fewShots ?? examples,
          marketIdentifier: config.marketIdentifier ?? identifier,
          pinned: input.session.pinned,
        },
        groupId: groupId && groupId !== 'default' ? groupId : undefined,
        visibility: config.visibility,
      });
      return agentId;
    }),

  /** Native activity signal. Payload dates are accepted but never trusted. */
  updateSession: sessionProcedure
    .use(withScopedPermission('session:update'))
    .input(
      z.object({
        id: z.string(),
        value: z
          .object({
            groupId: z.undefined().optional(),
            pinned: z.undefined().optional(),
            updatedAt: z.union([z.date(), z.number(), z.string()]).optional(),
          })
          .strict(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { agentId } = await resolveAgentReference(
        input.id,
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );
      await assertCanUseConversationTargets(
        { db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId },
        [{ agentId }],
      );
      return ctx.agentModel.touchUpdatedAt(agentId);
    }),
});

export type SessionRouter = typeof sessionRouter;
