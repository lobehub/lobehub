import { useParams, useSearchParams } from 'react-router';

import { useResolvedAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';

export const useAgentConversationCoordinate = () => {
  const params = useParams<{ aid?: string; topicId?: string }>();
  const [searchParams] = useSearchParams();
  const { agentId } = useResolvedAgentRouteId(params.aid);

  return [agentId, params.topicId ?? null, searchParams.get('thread')] as const;
};
