import { useResolvedAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';
import { useParams, useSearchParams } from '@/libs/router/navigation';

export const useAgentConversationCoordinate = () => {
  const params = useParams<{ aid?: string; topicId?: string }>('aid', 'topicId');
  const [searchParams] = useSearchParams();
  const { agentId } = useResolvedAgentRouteId(params.aid);

  return [agentId, params.topicId ?? null, searchParams.get('thread')] as const;
};
