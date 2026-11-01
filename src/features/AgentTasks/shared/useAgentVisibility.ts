import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

/**
 * Reads an agent's visibility from the sidebar-agent list (loaded eagerly on
 * app boot, so it has every agent the user can see). Returns `undefined` when
 * the agent is unknown to the current viewer — callers should treat that as
 * "no constraint", since the user can't have selected it via normal UI.
 */
export const useAgentVisibility = (
  agentId: string | null | undefined,
): 'private' | 'public' | undefined => {
  return useHomeStore((s) =>
    agentId ? homeAgentListSelectors.getAgentById(agentId)(s)?.visibility : undefined,
  );
};
