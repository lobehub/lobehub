import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

const builtinAgentSlugs = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

/**
 * Keep the inbox route valid while its persisted agent ID is still loading.
 * `useResolvedAgentRouteId` resolves the stable slug once initialization finishes.
 */
export const resolveInboxAgentRouteId = (inboxAgentId?: string) =>
  inboxAgentId ?? BUILTIN_AGENT_SLUGS.inbox;

export const useResolvedAgentRouteId = (routeAgentId?: string) => {
  const isBuiltinSlug = !!routeAgentId && builtinAgentSlugs.has(routeAgentId);
  const resolvedAgentId = useAgentStore(
    builtinAgentSelectors.getBuiltinAgentId(isBuiltinSlug ? routeAgentId! : ''),
  );

  return {
    agentId: isBuiltinSlug ? resolvedAgentId || routeAgentId : routeAgentId,
    isBuiltinSlug,
    resolvedAgentId,
  };
};
