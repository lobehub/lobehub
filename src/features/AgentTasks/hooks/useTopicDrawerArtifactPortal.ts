import { useMemo } from 'react';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

/** Portal views the run drawer can host in place of its conversation. */
const DRAWER_HOSTED_VIEW_TYPES = new Set<PortalViewType>([
  PortalViewType.Artifact,
  PortalViewType.FilePreview,
]);

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
    currentViewType &&
    DRAWER_HOSTED_VIEW_TYPES.has(currentViewType) &&
    (parentViewType === PortalViewType.TaskDetail || parentViewType === PortalViewType.TaskResult)
  ) {
    return parentViewType;
  }

  return currentViewType;
};

/**
 * Whether the visible portal view was opened from the conversation hosted by
 * the open run drawer: an artifact from one of its messages, or a file preview
 * opened from it. The drawer floats over the page's portal host, so these
 * render inside the drawer instead of behind it.
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
    if (!chatKey || !chatPortalSelectors.showStandalonePortal(s)) return false;

    if (chatPortalSelectors.showFilePreview(s))
      return chatPortalSelectors.previewFileSourceTopicId(s) === topicId;

    if (!chatPortalSelectors.showArtifactUI(s)) return false;

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
