import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentLabelModel } from '@/database/models/agentLabel';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { assertCanEditResource } from '@/server/services/resourcePermission';

/** Both partial unique indexes that guard active label names, per scope. */
const LABEL_NAME_CONSTRAINTS = new Set([
  'agent_labels_user_id_name_unique',
  'agent_labels_workspace_id_name_unique',
]);

/** Postgres surfaces the driver error somewhere down the `cause` chain. */
const getPostgresErrorField = (error: unknown, field: string): string | undefined => {
  let current: unknown = error;

  while (current && typeof current === 'object') {
    const value = (current as Record<string, unknown>)[field];
    if (typeof value === 'string') return value;

    current = (current as { cause?: unknown }).cause;
  }
};

/**
 * A name collision is a normal outcome the UI recovers from (rename, or
 * rename-and-restore for an archived label), so it must arrive as CONFLICT
 * rather than a generic 500 the client can only show as "operation failed".
 */
const rethrowDuplicateLabelName = (error: unknown): never => {
  if (
    getPostgresErrorField(error, 'code') === '23505' &&
    LABEL_NAME_CONSTRAINTS.has(getPostgresErrorField(error, 'constraint') ?? '')
  ) {
    throw new TRPCError({ cause: error, code: 'CONFLICT', message: 'DUPLICATE_LABEL_NAME' });
  }

  throw error;
};

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
      const data = await ctx.agentLabelModel.create(input).catch(rethrowDuplicateLabelName);

      return data?.id;
    }),

  getLabels: labelProcedure
    // The registry is workspace-shared, so reading it is what `agent_label:read`
    // exists to gate. Without this the permission is declared but unenforceable,
    // and a custom role denied it could still enumerate every label.
    .use(withScopedPermission('agent_label:read'))
    .query(async ({ ctx }) => {
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
   *
   * The role scope alone is not enough: it is workspace-wide, while the
   * agent's own permission row decides who may edit *this* agent. Without the
   * per-resource check a member holding `agent:update` could relabel a
   * teammate's public agent they can only view, so this goes through the same
   * guard the configuration endpoints use.
   */
  setAgentLabels: labelProcedure
    .use(withScopedPermission('agent:update'))
    .input(z.object({ agentId: z.string(), labelIds: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      await assertCanEditResource({
        db: ctx.serverDB,
        resourceId: input.agentId,
        resourceType: 'agent',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

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
      // Covers both a straight rename and un-archiving into a name that has
      // since been taken — the partial unique index only spans active rows.
      return ctx.agentLabelModel.update(input.id, input.value).catch(rethrowDuplicateLabelName);
    }),
});

export type AgentLabelRouter = typeof agentLabelRouter;
