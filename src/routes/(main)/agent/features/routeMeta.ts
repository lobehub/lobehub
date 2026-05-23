import { t } from 'i18next';
import { MessageSquare } from 'lucide-react';

import { lambdaClient } from '@/libs/trpc/client';
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
  createNewTab: (params) => {
    const agentId = params.aid;
    if (!agentId) return null;

    return {
      onCreate: async () => {
        const meta = agentSelectors.getAgentMetaById(agentId)(useAgentStore.getState());
        if (!meta || Object.keys(meta).length === 0) return null;

        const defaultTitle = t('defaultTitle', { ns: 'topic' });
        const topicId = await lambdaClient.topic.createTopic.mutate({
          agentId,
          messages: [],
          title: defaultTitle,
        });

        await useChatStore.getState().refreshTopic();

        return {
          cached: {
            avatar: meta.avatar,
            backgroundColor: meta.backgroundColor,
            title: defaultTitle,
          },
          url: `/agent/${agentId}/${topicId}`,
        };
      },
    };
  },
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
