import { MessageSquare } from 'lucide-react';

import { matchesRouteWorkspace, useRouteWorkspaceId } from '@/features/RouteMeta/workspaceScope';
import { type DynamicRouteMeta, routeMeta } from '@/spa/router/routeMeta';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';

const useTopicTitle = (
  agentId: string | undefined,
  topicId: string | undefined,
  routeWorkspaceId: string | null | undefined,
): string | undefined =>
  useChatStore((s) => {
    if (!agentId || !topicId || routeWorkspaceId === undefined) return undefined;

    const topic = s.topicDataMap[topicMapKey({ agentId })]?.items?.find(
      (item) => item.id === topicId,
    );
    return topic?.title || undefined;
  });

export const agentRouteMeta = routeMeta({
  icon: MessageSquare,
  titleKey: 'navigation.chat',
  useDynamicMeta: (params): DynamicRouteMeta => {
    const routeWorkspaceId = useRouteWorkspaceId(params);
    const meta = useAgentStore((s) => {
      const agentId = params.aid ?? '';
      const agent = s.agentMap[agentId];

      if (!matchesRouteWorkspace(agent?.workspaceId, routeWorkspaceId)) return {};

      return agentSelectors.getAgentMetaById(agentId)(s);
    });
    const topicTitle = useTopicTitle(params.aid, params.topicId ?? params.topic, routeWorkspaceId);
    const hasMeta = Object.keys(meta).length > 0;
    const agentTitle = hasMeta ? meta.title : undefined;

    return {
      avatar: meta.avatar,
      backgroundColor: meta.backgroundColor,
      title: [topicTitle, agentTitle].filter(Boolean).join(' · ') || undefined,
    };
  },
});
