import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import type { RouteWorkspaceId } from './workspaceScope';

// undefined: the topic row is not loaded yet; null: loaded but untitled. Searches every
// loaded bucket and the detail cache because desktop resolves background tabs too.
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
