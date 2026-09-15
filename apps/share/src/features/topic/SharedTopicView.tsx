'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useParams } from 'react-router';
import useSWR from 'swr';

import ShareShell, { ShareHero } from '@/business/client/features/ShareShell';
import { CONVERSATION_MIN_WIDTH } from '@/const/layoutTokens';
import { shareKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';
import { loadRouteWithBuiltinToolSurfaces } from '@/spa/initialize/toolSurfaces';

import { clientOnly } from '../../shell/clientOnly';
import TopicAvatar from './TopicAvatar';
import { buildTopicByline } from './topicByline';

const SharedTopicBody = clientOnly(() =>
  loadRouteWithBuiltinToolSurfaces(() => import('./SharedTopicBody.client')),
);
const SharedTopicAside = clientOnly(() => import('./SharedTopicAside.client'));

const SharedTopicView = memo(() => {
  const { id } = useParams<{ id: string }>();

  const { data, error, isLoading } = useSWR(
    id ? shareKeys.topic(id) : null,
    () => lambdaClient.share.getSharedTopic.query({ shareId: id! }),
    { revalidateOnFocus: false },
  );

  const marketIdentifier = data?.agentMeta?.marketIdentifier;
  const openUrl = marketIdentifier ? `/community/agent/${marketIdentifier}` : '/community/agent';

  // Mirror WideScreenContainer's centered column so the pre-hydration document
  // matches the hydrated ChatList headerSlot layout instead of hugging the left.
  const hero = data ? (
    <Flexbox width={'100%'}>
      <Flexbox
        paddingInline={16}
        style={{ alignSelf: 'center' }}
        width={`min(${CONVERSATION_MIN_WIDTH}px, 100%)`}
      >
        <ShareHero
          avatar={<TopicAvatar data={data} size={40} />}
          byline={buildTopicByline(data)}
          title={data.title}
        />
      </Flexbox>
    </Flexbox>
  ) : null;

  return (
    <ShareShell
      aside={<SharedTopicAside />}
      error={error}
      // The SSR document already carries the hero, and SWR revalidates on mount
      // with that data in cache — gating on `isLoading` alone would blank it.
      loading={isLoading && !data}
      share={{ avatar: data ? <TopicAvatar data={data} /> : undefined, openUrl }}
      title={data?.title}
    >
      {id && data ? <SharedTopicBody fallback={hero} shareId={id} /> : null}
    </ShareShell>
  );
});

SharedTopicView.displayName = 'SharedTopicView';

export default SharedTopicView;
