import { BotMessageSquareIcon } from 'lucide-react';
import { memo,Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useInitRecentTopic } from '@/hooks/useInitRecentTopic';
import { useHomeStore } from '@/store/home';
import { homeRecentSelectors } from '@/store/home/selectors';

import GroupBlock from '../components/GroupBlock';
import GroupSkeleton from '../components/GroupSkeleton';
import ScrollShadowWithButton from '../components/ScrollShadowWithButton';
import { RECENT_BLOCK_SIZE } from '../const';
import RecentTopicList from './List';

const RecentTopic = memo(() => {
  const { t } = useTranslation('chat');
  const recentTopics = useHomeStore(homeRecentSelectors.recentTopics);
  const isInit = useHomeStore(homeRecentSelectors.isRecentTopicsInit);
  const { isRevalidating } = useInitRecentTopic();

  // After loaded, if no data, don't render
  if (isInit && (!recentTopics || recentTopics.length === 0)) {
    return null;
  }

  return (
    <GroupBlock
      action={isRevalidating && <NeuralNetworkLoading size={14} />}
      icon={BotMessageSquareIcon}
      title={t('topic.recent')}
    >
      <ScrollShadowWithButton>
        <Suspense
          fallback={
            <GroupSkeleton
              height={RECENT_BLOCK_SIZE.TOPIC.HEIGHT}
              width={RECENT_BLOCK_SIZE.TOPIC.WIDTH}
            />
          }
        >
          <RecentTopicList />
        </Suspense>
      </ScrollShadowWithButton>
    </GroupBlock>
  );
});

export default RecentTopic;
