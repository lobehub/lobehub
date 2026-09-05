import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import useSWR from 'swr';

import type { AgentRouteResolution } from '@/server/routers/lambda/agent';
import { agentService } from '@/services/agent';

type AgentRouteResolutionKind = AgentRouteResolution['kind'];

const builtinAgentSlugs = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

/**
 * Every generated agent id carries an underscore (`agt_…`, `agent_…`) and no
 * generated slug does (`randomSlug` joins words with hyphens, and rename rejects
 * underscores). So the absence of one is what tells a slug route from an id
 * route — and a wrong guess only costs a lookup that resolves to nothing.
 */
export const looksLikeSlug = (routeAgentId?: string) =>
  !!routeAgentId && !routeAgentId.includes('_');

/** Builtin agents are addressed by a fixed slug that the store already knows. */
export const isBuiltinAgentSlug = (routeAgentId?: string) =>
  !!routeAgentId && builtinAgentSlugs.has(routeAgentId);

/**
 * A param only needs a server round trip when its shape leaves the answer open:
 * ids and builtin slugs are decided locally.
 */
export const needsAgentRouteLookup = (routeAgentId?: string) =>
  !isBuiltinAgentSlug(routeAgentId) && looksLikeSlug(routeAgentId);

export type AgentRouteBranch = 'loading' | 'own';

/**
 * Which surface `/agent/:slugOrId` renders for a given resolution state: the
 * creator's own agent, once the param has been resolved.
 *
 * A not-found param renders the creator surface too, which already owns the
 * agent not-found card — and so does a failed lookup, since there is nowhere
 * better for a dead link to land.
 */
export const resolveAgentRouteBranch = ({
  isLoading,
}: {
  isLoading: boolean;
  kind?: AgentRouteResolutionKind;
}): AgentRouteBranch => (isLoading ? 'loading' : 'own');

/**
 * Resolve a `/agent/:slugOrId` param to the creator's own agent id.
 *
 * Id-shaped params and builtin slugs are decided locally, so an ordinary
 * `/agent/<id>` route never pays for a request. Only a user-chosen slug asks
 * the server, and that answer is shared with `useResolvedAgentRouteId` through
 * the same SWR key, so the switch and the layout resolve it exactly once.
 */
export const useAgentRouteResolution = (routeAgentId?: string) => {
  const needsLookup = needsAgentRouteLookup(routeAgentId);

  const { data, isLoading } = useSWR(
    needsLookup ? ['agent-route', routeAgentId] : null,
    () => agentService.resolveAgentRoute(routeAgentId!),
    { revalidateOnFocus: false },
  );

  return {
    /** True only while a slug lookup is in flight, i.e. the kind is unknown yet. */
    isLoading: needsLookup && isLoading,
    kind: needsLookup ? data?.kind : ('own' as const),
    /** The id behind a user-chosen agent slug, once known. */
    resolvedAgentId: data?.kind === 'own' ? data.agentId : undefined,
  };
};
