import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentLabelModel } from '@/database/models/agentLabel';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

/**
 * `color` is rendered straight into an inline `background` on label tags, the
 * settings list and the picker dots, so an arbitrary string is a CSS injection
 * point — `url(https://…)` alone would make every member who can see the
 * shared label fetch an attacker-controlled resource. Constrain it to a hex
 * literal at the only two places it can be written.
 */
const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i, 'INVALID_LABEL_COLOR');

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
        color: hexColor.optional(),
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
   * Labelling is list organization, not agent configuration — the same bucket
   * as pinning and moving to a group, which members may already do to any
   * agent they can see. It therefore gates on the workspace-wide
   * `agent:update` role scope and deliberately NOT on the agent's own
   * permission row: requiring per-agent edit rights would stop a member
   * tagging most of the workspace's agents, which is exactly the shared list
   * they need to organize.
   *
   * Labels are shared, so this does let one member change state others see.
   * That is the intended collaborative trade-off — the operation is cheap,
   * reversible, and grants no configuration or data access. Two lines still
   * hold: the viewer role carries no `agent:update` grant at all, and
   * `agentOwnership()` in the model keeps another member's *private* agents
   * out of reach entirely.
   */
  setAgentLabels: labelProcedure
    .use(withScopedPermission('agent:update'))
    // Assigning requires reading too: the call takes label ids and returns the
    // effective set, so a role denied `agent_label:read` could otherwise probe
    // the registry through it — which would leave the read guards on
    // `getLabels` and the sidebar only half closing the door.
    .use(withScopedPermission('agent_label:read'))
    .input(z.object({ agentId: z.string(), labelIds: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      return ctx.agentLabelModel.setAgentLabels(input.agentId, input.labelIds);
    }),

  /**
   * Single-label delta. Same guards as `setAgentLabels`, but expresses one
   * toggle so a concurrent editor's change is not clobbered.
   */
  toggleAgentLabel: labelProcedure
    .use(withScopedPermission('agent:update'))
    .use(withScopedPermission('agent_label:read'))
    .input(z.object({ agentId: z.string(), assigned: z.boolean(), labelId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.agentLabelModel.toggleAgentLabel(input.agentId, input.labelId, input.assigned);
    }),

  updateLabel: labelProcedure
    .use(withScopedPermission('agent_label:update'))
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          archived: z.boolean().optional(),
          color: hexColor.nullable().optional(),
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
