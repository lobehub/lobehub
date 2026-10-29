import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';

import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';

const builtinAgentSlugs = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

/**
 * Every generated agent id carries an underscore (`agt_…`, `agent_…`) and no
 * generated slug does (`randomSlug` joins words with hyphens, and rename rejects
 * underscores). So the absence of one is what tells a slug route from an id
 * route — and a wrong guess only costs a lookup that resolves to null.
 */
export const looksLikeSlug = (routeAgentId?: string) =>
  !!routeAgentId && !routeAgentId.includes('_');

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
  const customSlug = isCustomSlug ? routeAgentId : undefined;
  const useResolveAgentSlug = useAgentStore((s) => s.useResolveAgentSlug);
  useResolveAgentSlug(customSlug);
  // The persisted `slug → id` paints the agent right away; the lookup confirms it.
  const slugAgentId = useAgentStore(agentSelectors.getAgentIdBySlug(customSlug));
  const isSlugConfirmed = useAgentStore(agentSelectors.isAgentSlugConfirmed(customSlug));

  const agentId = (isBuiltinSlug ? builtinAgentId : slugAgentId) || routeAgentId;
  // A slug can move to another agent between sessions, so a user-chosen slug is
  // only swapped for its id (the URL redirect) once the server confirmed it.
  const resolvedAgentId = isBuiltinSlug
    ? builtinAgentId
    : isSlugConfirmed
      ? slugAgentId
      : undefined;

  return {
    agentId,
    isBuiltinSlug,
    /** The route param is a slug (builtin or user-chosen), so it must be swapped for an id. */
    isSlugRoute: isBuiltinSlug || isCustomSlug,
    resolvedAgentId,
  };
};
