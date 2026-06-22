import { MessageSquare } from 'lucide-react';

import { type DynamicRouteMeta, routeMeta } from '@/spa/router/routeMeta';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

const useTopicTitle = (topicId: string | undefined): string | undefined =>
  useChatStore((s) => {
    if (!topicId) return undefined;
    for (const data of Object.values(s.topicDataMap)) {
      const topic = data.items?.find((item) => item.id === topicId);
      if (topic?.title) return topic.title;
    }
    return undefined;
  });

export const agentRouteMeta = routeMeta({
  icon: MessageSquare,
  titleKey: 'navigation.chat',
  useDynamicMeta: (params): DynamicRouteMeta => {
    const meta = useAgentStore(agentSelectors.getAgentMetaById(params.aid ?? ''));
    const topicTitle = useTopicTitle(params.topicId);
    const hasMeta = Object.keys(meta).length > 0;
    const agentTitle = hasMeta ? meta.title : undefined;

    return {
      avatar: meta.avatar,
      backgroundColor: meta.backgroundColor,
      title: [topicTitle, agentTitle].filter(Boolean).join(' · ') || undefined,
    };
  },
});
