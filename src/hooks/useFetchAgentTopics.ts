import { topicKeys } from '@/libs/swr/keys';
import { useChatTopicsProjectionRequest } from '@/projection';
import { useChatStore } from '@/store/chat';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';

export const useFetchAgentTopics = ({
  agentId,
  enabled = true,
  pageSize = 20,
  surface = 'sidebar',
  withDetails,
}: {
  agentId?: string;
  enabled?: boolean;
  pageSize?: number;
  surface?: 'agentView' | 'sidebar';
  withDetails?: boolean;
}) => {
  const creatingTopicIds = useChatStore((state) => state.creatingTopicIds);
  const containerKey = topicMapKey({ agentId });
  const key =
    surface === 'agentView'
      ? topicKeys.agentView(containerKey, { pageSize, withDetails })
      : topicKeys.list(containerKey, { pageSize, withDetails });

  return useChatTopicsProjectionRequest(
    agentId && enabled ? key : null,
    {
      containerKey,
      context: { agentId: agentId ?? null },
      page: 0,
      pageSize,
      preserveIds: surface === 'sidebar' ? creatingTopicIds : undefined,
      request: { agentId, current: 0, pageSize, withDetails },
      signature: { withDetails },
      surface,
    },
    Boolean(agentId && enabled),
  );
};
