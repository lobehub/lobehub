import { Users } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

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
