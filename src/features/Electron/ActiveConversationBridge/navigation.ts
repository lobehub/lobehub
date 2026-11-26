import { appNavigate } from '@/features/Electron/navigation/appNavigate';
import { getTabRouter } from '@/features/Electron/TabHost/tabRouterManager';
import { normalizeTabUrl } from '@/features/Electron/titlebar/TabBar/url';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';

import { type ActiveConversationCoordinate, buildActiveConversationUrl } from './coordinate';

type Navigate = (url: string, options: { replace: true }) => void;

const readActiveTabRouterUrl = (): string | undefined => {
  const { activeTabId } = useElectronStore.getState();
  const location = activeTabId ? getTabRouter(activeTabId)?.state.location : undefined;
  return location && `${location.pathname}${location.search}`;
};

const toComparableUrl = (url: string) => {
  const { pathname, search } = new URL(url, 'https://desktop.local');
  return normalizeTabUrl(`${pathname}${search}`);
};

export const subscribeActiveConversationNavigation = (
  getCoordinate: () => ActiveConversationCoordinate,
  navigate: Navigate = appNavigate,
  getRouterUrl: () => string | undefined = readActiveTabRouterUrl,
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

    // The coordinate follows the tab url, which TabLocationReporter updates one
    // effect after the router moves. A page that just mounted can change the topic
    // in that gap; rewriting from the stale coordinate would yank the tab back.
    const routerUrl = getRouterUrl();
    if (
      routerUrl !== undefined &&
      toComparableUrl(routerUrl) !== toComparableUrl(`${coordinate.pathname}${coordinate.search}`)
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

    navigate(buildActiveConversationUrl(coordinate, topicId, threadId), { replace: true });
  });
