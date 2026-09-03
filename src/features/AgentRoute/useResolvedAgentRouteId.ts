import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

import {
  isBuiltinAgentSlug,
  looksLikeSlug,
  useAgentRouteResolution,
} from './useAgentRouteResolution';

/**
 * Keep the inbox route valid while its persisted agent ID is still loading.
 * `useResolvedAgentRouteId` resolves the stable slug once initialization finishes.
 */
export const resolveInboxAgentRouteId = (inboxAgentId?: string) =>
  inboxAgentId ?? BUILTIN_AGENT_SLUGS.inbox;

export const useResolvedAgentRouteId = (routeAgentId?: string) => {
  const isBuiltinSlug = isBuiltinAgentSlug(routeAgentId);
  const builtinAgentId = useAgentStore(
    builtinAgentSelectors.getBuiltinAgentId(isBuiltinSlug ? routeAgentId! : ''),
  );

  // A user-chosen slug needs a server lookup; builtin slugs already resolve from
  // the store. The lookup is shared with `AgentRouteSwitch`, which asks the same
  // question one level up in the tree.
  const isCustomSlug = !isBuiltinSlug && looksLikeSlug(routeAgentId);
  const { resolvedAgentId: slugAgentId } = useAgentRouteResolution(routeAgentId);

  const resolvedAgentId = isBuiltinSlug ? builtinAgentId : slugAgentId;

  return {
    agentId: resolvedAgentId || routeAgentId,
    isBuiltinSlug,
    /** The route param is a slug (builtin or user-chosen), so it must be swapped for an id. */
    isSlugRoute: isBuiltinSlug || isCustomSlug,
    resolvedAgentId,
  };
};
