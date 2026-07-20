'use client';

import { memo } from 'react';
import { useParams } from 'react-router';
import useSWR from 'swr';

import { ShareHero } from '@/business/client/features/ShareShell';
import { shareKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';

import TopicAvatar from './features/TopicAvatar';
import SharedMessageList from './SharedMessageList';

const ShareTopicPage = memo(() => {
  const { id } = useParams<{ id: string }>();

  const { data } = useSWR(
    id ? shareKeys.topic(id) : null,
    () => lambdaClient.share.getSharedTopic.query({ shareId: id! }),
    { revalidateOnFocus: false },
  );

  if (!data) return null;

  const isInboxAgent = !data.groupId && data.agentMeta?.slug === 'inbox';
  const agentOrGroupTitle =
    data.groupMeta?.title || (isInboxAgent ? 'Lobe AI' : data.agentMeta?.title);

  return (
    <SharedMessageList
      agentId={data.agentId}
      groupId={data.groupId}
      shareId={data.shareId}
      topicId={data.topicId}
      headerSlot={
        <ShareHero
          avatar={<TopicAvatar data={data} size={40} />}
          byline={agentOrGroupTitle}
          title={data.title}
        />
      }
    />
  );
});

export default ShareTopicPage;
