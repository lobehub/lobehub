import { Users } from 'lucide-react';

import { matchesRouteWorkspace, useRouteWorkspaceId } from '@/features/RouteMeta/workspaceScope';
import { type DynamicRouteMeta, routeMeta } from '@/spa/router/routeMeta';
import { useChatStore } from '@/store/chat';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import { useSessionStore } from '@/store/session';
import { sessionGroupSelectors } from '@/store/session/slices/sessionGroup/selectors';

const getWorkspaceId = (item: unknown): string | null | undefined =>
  (item as { workspaceId?: string | null } | undefined)?.workspaceId;

const useTopicTitle = (
  groupId: string | undefined,
  topicId: string | undefined,
  routeWorkspaceId: string | null | undefined,
): string | undefined =>
  useChatStore((s) => {
    if (!groupId || !topicId || routeWorkspaceId === undefined) return undefined;

    const topic = s.topicDataMap[topicMapKey({ groupId })]?.items?.find(
      (item) => item.id === topicId,
    );
    return topic?.title || undefined;
  });

export const groupRouteMeta = routeMeta({
  icon: Users,
  titleKey: 'navigation.groupChat',
  useDynamicMeta: (params): DynamicRouteMeta => {
    const routeWorkspaceId = useRouteWorkspaceId(params);
    const group = useSessionStore((s) => {
      const item = sessionGroupSelectors.getGroupById(params.gid ?? '')(s);
      return matchesRouteWorkspace(getWorkspaceId(item), routeWorkspaceId) ? item : undefined;
    });
    const topicTitle = useTopicTitle(params.gid, params.topic, routeWorkspaceId);

    return {
      title: topicTitle || group?.name || undefined,
    };
  },
});
