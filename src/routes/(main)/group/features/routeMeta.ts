import { t } from 'i18next';
import { Users } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { lambdaClient } from '@/libs/trpc/client';
import { type DynamicRouteMeta, routeMeta } from '@/spa/router/routeMeta';
import { useChatStore } from '@/store/chat';
import { useSessionStore } from '@/store/session';
import { sessionGroupSelectors } from '@/store/session/slices/sessionGroup/selectors';

const useTopicTitle = (topicId: string | null): string | undefined =>
  useChatStore((s) => {
    if (!topicId) return undefined;
    for (const data of Object.values(s.topicDataMap)) {
      const topic = data.items?.find((item) => item.id === topicId);
      if (topic?.title) return topic.title;
    }
    return undefined;
  });

export const groupRouteMeta = routeMeta({
  createNewTab: (params) => {
    const groupId = params.gid;
    if (!groupId) return null;

    return {
      onCreate: async () => {
        const group = sessionGroupSelectors.getGroupById(groupId)(useSessionStore.getState());
        if (!group) return null;

        const defaultTitle = t('defaultTitle', { ns: 'topic' });
        const topicId = await lambdaClient.topic.createTopic.mutate({
          groupId,
          messages: [],
          title: defaultTitle,
        });

        await useChatStore.getState().refreshTopic();

        return {
          cached: { title: defaultTitle },
          url: `/group/${groupId}?topic=${topicId}`,
        };
      },
    };
  },
  icon: Users,
  titleKey: 'navigation.groupChat',
  useDynamicMeta: (params): DynamicRouteMeta => {
    const [searchParams] = useSearchParams();
    const group = useSessionStore(sessionGroupSelectors.getGroupById(params.gid ?? ''));
    const topicTitle = useTopicTitle(searchParams.get('topic'));

    return {
      title: topicTitle || group?.name || undefined,
    };
  },
});
