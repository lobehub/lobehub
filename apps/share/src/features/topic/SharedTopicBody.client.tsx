'use client';

import { memo } from 'react';
import useSWR from 'swr';

import { ShareHero } from '@/business/client/features/ShareShell';
import { shareKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';

import SharedMessageList from './SharedMessageList';
import TopicAvatar from './TopicAvatar';
import { buildTopicByline } from './topicByline';
import { useSyncSharedTopicMeta } from './useSyncSharedTopicMeta';

interface SharedTopicBodyProps {
  shareId: string;
}

const SharedTopicBody = memo<SharedTopicBodyProps>(({ shareId }) => {
  const { data } = useSWR(
    shareKeys.topic(shareId),
    () => lambdaClient.share.getSharedTopic.query({ shareId }),
    { revalidateOnFocus: false },
  );

  useSyncSharedTopicMeta(data);

  if (!data) return null;

  return (
    <SharedMessageList
      agentId={data.agentId}
      groupId={data.groupId}
      shareId={data.shareId}
      topicId={data.topicId}
      headerSlot={
        <ShareHero
          avatar={<TopicAvatar data={data} size={40} />}
          byline={buildTopicByline(data)}
          title={data.title}
        />
      }
    />
  );
});

SharedTopicBody.displayName = 'SharedTopicBody';

export default SharedTopicBody;
