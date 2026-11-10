import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { router } from '@/libs/trpc/lambda';
import { assertCanEditResource } from '@/server/services/resourcePermission';

import { agentProcedure } from './procedures';

/** What a `/agent/:slugOrId` param resolves to — see `resolveAgentRoute`. */
export interface AgentRouteResolution {
  /** The resolved agent id. Present for `own` routes. */
  agentId?: string;
  /**
   * `own`: one of the caller's agents (by id or by agent slug).
   * `notFound`: no agent of the caller's claims the param — the caller sees
   *   the agent not-found surface.
   */
  kind: 'own' | 'notFound';
}

export const routingRouter = router({
  /**
   * Resolve a slug to its agent id so `/agent/:slug` can open the agent.
   *
   * Read-only and ownership-scoped: an unknown slug and someone else's slug both
   * return `null`, so this cannot be used to probe which slugs exist.
   */
  resolveAgentIdBySlug: agentProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input, ctx }) => {
      const agentId = await ctx.agentModel.resolveIdBySlug(input.slug);
      return { agentId };
    }),
  /**
   * Compatibility endpoint for released clients that still resolve their
   * agent routes here. Keep ownership-scoped lookup behavior so those clients
   * can open their own agents without restoring share-link routing.
   *
   * @deprecated New clients resolve slugs with `resolveAgentIdBySlug`.
   *
   * Resolution order, cheapest first:
   * 1. an id-shaped param is always an own-agent route (no query at all);
   * 2. an ownership-scoped agent-slug lookup;
   * 3. otherwise `notFound`.
   *
   * The slug lookup is ownership-scoped on purpose: a stranger's slug reads as
   * `notFound`, so this resolver cannot be used to probe which slugs exist.
   */
  resolveAgentRoute: agentProcedure
    .input(z.object({ slugOrId: z.string().trim().min(1) }))
    .query(async ({ input, ctx }): Promise<AgentRouteResolution> => {
      const { slugOrId } = input;

      // Every generated agent id carries an underscore (`agt_…`) and no
      // generated slug does, so the shape alone settles this case. A bogus
      // id still routes to the own-agent shell, which owns the not-found UI.
      if (slugOrId.includes('_')) return { agentId: slugOrId, kind: 'own' };

      const agentId = await ctx.agentModel.resolveIdBySlug(slugOrId);
      if (agentId) return { agentId, kind: 'own' };

      return { kind: 'notFound' };
    }),
  /**
   * Rename an agent's url slug. Separate from `updateAgentConfig` because `slug`
   * is immutable there by design — see `IMMUTABLE_AGENT_FIELDS`.
   */
  updateAgentSlug: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(z.object({ agentId: z.string(), slug: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await assertCanEditResource({
        db: ctx.serverDB,
        resourceId: input.agentId,
        resourceType: 'agent',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      return ctx.agentModel.updateSlug(input.agentId, input.slug);
    }),
});
