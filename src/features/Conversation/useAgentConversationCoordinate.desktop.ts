import { useParams, useSearchParams } from 'react-router';

import { useResolvedAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';
import { useProjectTopics } from '@/store/projectWorkingDirectory';

export const useAgentConversationCoordinate = () => {
  const params = useParams<{ aid?: string; projectId?: string; topicId?: string }>();
  const [searchParams] = useSearchParams();
  const { agentId } = useResolvedAgentRouteId(params.aid);
  // Project conversation routes carry :projectId/:topicId instead of :aid, so the
  // owning agent resolves from the project topic — still route-derived per tab,
  // never the global pointer (another tab may own it).
  const projectTopics = useProjectTopics(params.aid ? undefined : params.projectId);
  const projectTopicAgentId = params.projectId
    ? projectTopics.find((topic) => topic.id === params.topicId)?.agentId
    : undefined;

  return [
    agentId ?? projectTopicAgentId,
    params.topicId ?? null,
    searchParams.get('thread'),
  ] as const;
};
