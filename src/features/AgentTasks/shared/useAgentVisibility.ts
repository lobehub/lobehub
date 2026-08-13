import {
  homeSidebarSelectors,
  useHomeSidebarProjection,
} from '@/projection/modules/home/sidebarHooks';

/**
 * Reads an agent's visibility from the sidebar-agent list (loaded eagerly on
 * app boot, so it has every agent the user can see). Returns `undefined` when
 * the agent is unknown to the current viewer — callers should treat that as
 * "no constraint", since the user can't have selected it via normal UI.
 */
export const useAgentVisibility = (
  agentId: string | null | undefined,
): 'private' | 'public' | undefined => {
  return useHomeSidebarProjection((sidebar) =>
    agentId ? homeSidebarSelectors.getAgentById(agentId)(sidebar)?.visibility : undefined,
  );
};
