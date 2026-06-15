import { MessageSquare } from 'lucide-react';
import useSWR from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';
import { routeMeta } from '@/spa/router/routeMeta';

export const shareTopicRouteMeta = routeMeta({
  icon: MessageSquare,
  titleKey: 'navigation.chat',
  useDynamicMeta: (params) => {
    const shareId = params.id;
    const { data } = useSWR(
      shareId ? shareKeys.topic(shareId) : null,
      () => lambdaClient.share.getSharedTopic.query({ shareId: shareId! }),
      { revalidateOnFocus: false },
    );

    return {
      title: data?.title || undefined,
    };
  },
});
