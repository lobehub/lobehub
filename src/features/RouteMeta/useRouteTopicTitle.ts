import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import type { RouteWorkspaceId } from './workspaceScope';

/**
 * Title of the route's topic: `undefined` while its row is not loaded, `null`
 * once loaded but still untitled.
 *
 * Desktop resolves every tab's meta, not only the focused one, so this looks in
 * every loaded list bucket and the by-id detail cache (archived topics).
 */
export const useRouteTopicTitle = (
  topicId: string | undefined,
  routeWorkspaceId: RouteWorkspaceId,
): string | null | undefined =>
  useChatStore((state) => {
    if (!topicId || routeWorkspaceId === undefined) return undefined;

    const topic = topicSelectors.getTopicById(topicId)(state);
    if (!topic) return undefined;
    return topic.title || null;
  });
