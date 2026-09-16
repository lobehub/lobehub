import { useMemo } from 'react';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

interface ResolveTopicDrawerPortalHostViewTypeOptions {
  currentViewType: PortalViewType | null;
  parentViewType: PortalViewType | null;
  showArtifactPortal: boolean;
}

export const resolveTopicDrawerPortalHostViewType = ({
  currentViewType,
  parentViewType,
  showArtifactPortal,
}: ResolveTopicDrawerPortalHostViewTypeOptions): PortalViewType | null => {
  if (
    showArtifactPortal &&
    currentViewType === PortalViewType.Artifact &&
    (parentViewType === PortalViewType.TaskDetail || parentViewType === PortalViewType.TaskResult)
  ) {
    return parentViewType;
  }

  return currentViewType;
};

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

/**
 * Keeps a parent Task portal mounted while its open run drawer hosts the top Artifact view.
 */
export const useTopicDrawerPortalHostViewType = () => {
  const showArtifactPortal = useTopicDrawerArtifactPortal();

  return useChatStore((s) =>
    resolveTopicDrawerPortalHostViewType({
      currentViewType: chatPortalSelectors.currentViewType(s),
      parentViewType: s.portalStack.at(-2)?.type ?? null,
      showArtifactPortal,
    }),
  );
};
