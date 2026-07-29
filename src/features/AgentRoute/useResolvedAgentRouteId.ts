import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

const builtinAgentSlugs = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

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
