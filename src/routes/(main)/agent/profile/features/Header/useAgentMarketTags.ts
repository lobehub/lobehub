import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useDiscoverStore } from '@/store/discover';
import { marketSelectors } from '@/store/discover/selectors';

/**
 * What the status, review and fork tags of the agent profile header show for
 * the current agent's Market listing. Every tag calls this hook; they share one
 * Market status read (and one fork-source read, asked for only once the agent
 * is known to be a fork), painted from the local replica first.
 */
export const useAgentMarketTags = () => {
  const marketIdentifier = useAgentStore(agentSelectors.currentAgentMeta)?.marketIdentifier;

  const useMarketAgentStatus = useDiscoverStore((s) => s.useMarketAgentStatus);
  const { queryKey: statusKey } = useMarketAgentStatus(marketIdentifier);
  const marketStatus = useDiscoverStore(marketSelectors.agentStatus(statusKey));

  const useAgentForkSource = useDiscoverStore((s) => s.useAgentForkSource);
  const { queryKey: forkKey } = useAgentForkSource(
    marketIdentifier,
    !!marketStatus?.forkedFromAgentId,
  );
  const forkSource = useDiscoverStore(marketSelectors.agentForkSource(forkKey));

  return {
    forkSource: forkSource ?? null,
    isUnderReview: !!marketStatus?.latestVersionUnderReview,
    status: marketStatus?.status ?? null,
  };
};
