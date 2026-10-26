'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useParams } from 'react-router';
import useSWR from 'swr';

import { ShareHero } from '@/business/client/features/ShareShell';
import { CONVERSATION_MIN_WIDTH } from '@/const/layoutTokens';
import { shareKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';
import { loadRouteWithBuiltinToolSurfaces } from '@/spa/initialize/toolSurfaces';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { type SharedTopicData } from '@/types/topic';

import { clientOnly } from '../../shell/clientOnly';
import ShareLayout from '../../shell/ShareLayout';
import ExplainTopic, { useExplainTopicAction } from './ExplainTopic';
import {
  primeSharedTopicMessages,
  type SharedTopicFirstPage,
  type SharedTopicReadMode,
} from './sharedConversation';
import TopicAvatar from './TopicAvatar';
import { buildTopicByline } from './topicByline';

const SharedTopicBody = clientOnly(() =>
  loadRouteWithBuiltinToolSurfaces(() => import('./SharedTopicBody.client')),
);
const SharedTopicAside = clientOnly(() => import('./SharedTopicAside.client'));

/**
 * Everything the conversation needs before it can paint: its chunk and the
 * messages the document carries. The route calls this as the hydrated router
 * initializes, ahead of the body's own mount.
 */
export const preloadSharedTopic = (topic: SharedTopicData, firstPage: SharedTopicFirstPage) => {
  SharedTopicBody.preload();
  primeSharedTopicMessages(topic, firstPage);
};

interface SharedTopicViewProps {
  messageReadMode: SharedTopicReadMode;
}

const SharedTopicView = memo<SharedTopicViewProps>(({ messageReadMode }) => {
  const wideScreen = useGlobalStore(systemStatusSelectors.wideScreen);
  const { id } = useParams<{ id: string }>();
  const explain = useExplainTopicAction(id ?? '');

  const { data, error, isLoading } = useSWR(
    id ? shareKeys.topic(id) : null,
    () => lambdaClient.share.getSharedTopic.query({ shareId: id! }),
    { revalidateOnFocus: false },
  );

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
    <ShareLayout
      actions={id && data?.visibility === 'link' ? <ExplainTopic action={explain} /> : undefined}
      aside={<SharedTopicAside />}
      contentWidth={wideScreen ? undefined : CONVERSATION_MIN_WIDTH}
      error={error}
      loading={isLoading && !data}
      title={data?.title}
      compactActions={
        id && data?.visibility === 'link'
          ? [
              {
                key: 'explain-topic',
                label: explain.label,
                onClick: () => {
                  void explain.copyPrompt();
                },
              },
            ]
          : undefined
      }
    >
      {id && data ? (
        <SharedTopicBody fallback={hero} messageReadMode={messageReadMode} shareId={id} />
      ) : null}
    </ShareLayout>
  );
});

SharedTopicView.displayName = 'SharedTopicView';

export default SharedTopicView;
