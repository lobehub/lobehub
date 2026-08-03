import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentLabelModel } from '@/database/models/agentLabel';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const labelProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentLabelModel: new AgentLabelModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

export const agentLabelRouter = router({
  createLabel: labelProcedure
    .use(withScopedPermission('agent_label:create'))
    .input(
      z.object({
        color: z.string().optional(),
        description: z.string().optional(),
        name: z.string().trim().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const data = await ctx.agentLabelModel.create(input);

      return data?.id;
    }),

  getLabels: labelProcedure.query(async ({ ctx }) => {
    return ctx.agentLabelModel.query();
  }),

  removeLabel: labelProcedure
    .use(withScopedPermission('agent_label:delete'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.agentLabelModel.delete(input.id);
    }),

  /**
   * Assigning labels is an agent mutation, so it rides on `agent:update`
   * instead of the label-management scopes — members can label the agents
   * they are allowed to edit even though label CRUD is admin-gated.
   */
  setAgentLabels: labelProcedure
    .use(withScopedPermission('agent:update'))
    .input(z.object({ agentId: z.string(), labelIds: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      return ctx.agentLabelModel.setAgentLabels(input.agentId, input.labelIds);
    }),

  updateLabel: labelProcedure
    .use(withScopedPermission('agent_label:update'))
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          archived: z.boolean().optional(),
          color: z.string().nullable().optional(),
          description: z.string().nullable().optional(),
          name: z.string().trim().min(1).optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentLabelModel.update(input.id, input.value);
    }),
});

export type AgentLabelRouter = typeof agentLabelRouter;
