import { MessageSquare } from 'lucide-react';
import useSWR from 'swr';

import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import { shareKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';

const ShareTopicDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const shareId = params.id;
  const { data } = useSWR(
    shareId ? shareKeys.topic(shareId) : null,
    () => lambdaClient.share.getSharedTopic.query({ shareId: shareId! }),
    { revalidateOnFocus: false },
  );

  usePublishDynamicRouteMeta(
    {
      title: data?.title || undefined,
    },
    onResolve,
  );

  return null;
};

export const shareTopicRouteMeta = routeMeta({
  DynamicMeta: ShareTopicDynamicMeta,
  icon: MessageSquare,
  titleKey: 'navigation.chat',
});
