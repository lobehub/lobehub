import { useParams } from 'react-router';

import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useDiscoverStore } from '@/store/discover';
import { marketSelectors } from '@/store/discover/selectors';

/**
 * What the review and fork tags of the group profile show for the current
 * group's Market listing, painted from the local replicas first.
 */
export const useGroupMarketTags = () => {
  const { gid } = useParams<{ gid: string }>();
  const marketIdentifier = useAgentGroupStore((s) =>
    agentGroupSelectors.getGroupMeta(gid ?? '')(s),
  )?.marketIdentifier;

  const useMarketAgentGroupStatus = useDiscoverStore((s) => s.useMarketAgentGroupStatus);
  const { queryKey: statusKey } = useMarketAgentGroupStatus(marketIdentifier);
  const marketStatus = useDiscoverStore(marketSelectors.agentGroupStatus(statusKey));

  const useAgentGroupForkSource = useDiscoverStore((s) => s.useAgentGroupForkSource);
  const { queryKey: forkKey } = useAgentGroupForkSource(marketIdentifier);
  const forkSource = useDiscoverStore(marketSelectors.agentGroupForkSource(forkKey));

  return {
    forkSource: forkSource ?? null,
    isUnderReview: !!marketStatus?.latestVersionUnderReview,
  };
};
