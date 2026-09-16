import { useMemo } from 'react';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

/**
 * Whether the visible artifact belongs to the conversation hosted by the open run drawer.
 */
export const useTopicDrawerArtifactPortal = () => {
  const [topicId, agentId] = useTaskStore((s) => [
    taskDetailSelectors.activeTopicDrawerTopicId(s),
    taskDetailSelectors.topicDrawerAgentId(s),
  ]);

  const chatKey = useMemo(() => {
    if (!agentId || !topicId) return;

    return messageMapKey({ agentId, scope: 'main', topicId });
  }, [agentId, topicId]);

  return useChatStore((s) => {
    if (
      !chatKey ||
      !chatPortalSelectors.showStandalonePortal(s) ||
      !chatPortalSelectors.showArtifactUI(s)
    ) {
      return false;
    }

    const artifactMessageId = chatPortalSelectors.artifactMessageId(s);
    if (!artifactMessageId) return false;

    return [s.messagesMap[chatKey], s.dbMessagesMap[chatKey]].some((messages) =>
      messages?.some((message) => message.id === artifactMessageId),
    );
  });
};
