import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import useSWR from 'swr';

import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

const builtinAgentSlugs = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

/**
 * Every generated agent id carries an underscore (`agt_…`, `agent_…`) and no
 * generated slug does (`randomSlug` joins words with hyphens, and rename rejects
 * underscores). So the absence of one is what tells a slug route from an id
 * route — and a wrong guess only costs a lookup that resolves to null.
 */
const looksLikeSlug = (routeAgentId?: string) => !!routeAgentId && !routeAgentId.includes('_');

/**
 * Keep the inbox route valid while its persisted agent ID is still loading.
 * `useResolvedAgentRouteId` resolves the stable slug once initialization finishes.
 */
export const resolveInboxAgentRouteId = (inboxAgentId?: string) =>
  inboxAgentId ?? BUILTIN_AGENT_SLUGS.inbox;

export const useResolvedAgentRouteId = (routeAgentId?: string) => {
  const isBuiltinSlug = !!routeAgentId && builtinAgentSlugs.has(routeAgentId);
  const builtinAgentId = useAgentStore(
    builtinAgentSelectors.getBuiltinAgentId(isBuiltinSlug ? routeAgentId! : ''),
  );

  // A user-chosen slug needs a server lookup; builtin slugs already resolve from
  // the store. Gated on the shape check so an ordinary `/agent/<id>` route never
  // pays for a request.
  const isCustomSlug = !isBuiltinSlug && looksLikeSlug(routeAgentId);
  const { data: slugAgentId } = useSWR(
    isCustomSlug ? ['agent-id-by-slug', routeAgentId] : null,
    () => agentService.resolveAgentIdBySlug(routeAgentId!),
    { revalidateOnFocus: false },
  );

  const resolvedAgentId = isBuiltinSlug ? builtinAgentId : (slugAgentId ?? undefined);

  return {
    agentId: resolvedAgentId || routeAgentId,
    isBuiltinSlug,
    /** The route param is a slug (builtin or user-chosen), so it must be swapped for an id. */
    isSlugRoute: isBuiltinSlug || isCustomSlug,
    resolvedAgentId,
  };
};
