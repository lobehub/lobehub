import { appNavigate } from '@/features/Electron/navigation/appNavigate';
import { useChatStore } from '@/store/chat';
import { portalThreadSelectors } from '@/store/chat/selectors';

import { type ActiveConversationCoordinate, buildActiveConversationUrl } from './coordinate';

type Navigate = (url: string, options: { replace: true }) => void;

export const subscribeActiveConversationNavigation = (
  getCoordinate: () => ActiveConversationCoordinate,
  navigate: Navigate = appNavigate,
) =>
  useChatStore.subscribe((state, previousState) => {
    if (
      state.activeTopicId === previousState.activeTopicId &&
      state.activeThreadId === previousState.activeThreadId
    ) {
      return;
    }

    const coordinate = getCoordinate();
    if (
      !coordinate.isConversation ||
      (!coordinate.routeAgentId && !coordinate.groupId && !coordinate.projectId)
    )
      return;

    if (state.activeTopicId === undefined && coordinate.topicId) {
      useChatStore.setState(
        { activeTopicId: coordinate.topicId },
        false,
        'ActiveConversationBridge/restoreTopicAfterScopedReset',
      );
      return;
    }

    const topicId = state.activeTopicId || null;
    const threadId = state.activeThreadId || null;
    if (topicId === coordinate.topicId && threadId === coordinate.threadId) return;

    // A topic switch drops the Portal's thread when it belongs to the old topic;
    // carried along, it reopens on the new topic as an empty pane.
    const keepPortalThread =
      state.activeTopicId === previousState.activeTopicId ||
      portalThreadSelectors.isPortalThreadKeptOnTopic(topicId)(state);

    navigate(buildActiveConversationUrl(coordinate, topicId, threadId, { keepPortalThread }), {
      replace: true,
    });
  });
