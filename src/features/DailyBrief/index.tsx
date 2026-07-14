import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Newspaper } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import TopicChatDrawer from '@/features/AgentTasks/AgentTaskDetail/TopicChatDrawer';
import DocumentPreviewModal from '@/features/DocumentModal/Preview';
import Recommendations, { useRecommendationsVisible } from '@/features/Recommendations';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import GroupBlock from '@/routes/(main)/home/features/components/GroupBlock';
import { useBriefStore } from '@/store/brief';
import { briefListSelectors } from '@/store/brief/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import BriefCard from './BriefCard';
import { BriefCardSkeleton } from './BriefCardSkeleton';

const DailyBrief = memo(() => {
  const { t } = useTranslation('home');
  const navigate = useWorkspaceAwareNavigate();
  const isLogin = useUserStore(authSelectors.isLogin);
  const useFetchBriefs = useBriefStore((s) => s.useFetchBriefs);
  const briefsSWR = useFetchBriefs(isLogin);

  const briefs = useBriefStore(briefListSelectors.briefs);
  const isInit = useBriefStore(briefListSelectors.isBriefsInit);
  const recommendationsVisible = useRecommendationsVisible();

  if (!isLogin) return null;

  if (briefsSWR.error && !isInit && !briefsSWR.isLoading) {
    return (
      <GroupBlock icon={Newspaper} title={t('brief.title')}>
        <AsyncError
          error={briefsSWR.error}
          variant={'block'}
          onRetry={() => {
            void briefsSWR.mutate();
          }}
        />
      </GroupBlock>
    );
  }

  if (!isInit) {
    return (
      <GroupBlock icon={Newspaper} title={t('brief.title')}>
        <Flexbox gap={12}>
          <BriefCardSkeleton />
          <BriefCardSkeleton />
          <Recommendations />
        </Flexbox>
      </GroupBlock>
    );
  }

  if (briefs.length === 0) {
    // Without a titled brief block above it, the bare recommendations list
    // doesn't need the full section gap below the input area — offset the
    // parent's gap so it sits closer to the input.
    return recommendationsVisible ? (
      <Flexbox style={{ marginBlockStart: -24 }}>
        <Recommendations />
      </Flexbox>
    ) : null;
  }

  return (
    <GroupBlock
      actionAlwaysVisible
      icon={Newspaper}
      title={t('brief.title')}
      action={
        <Button size={'small'} type={'text'} onClick={() => navigate('/tasks')}>
          {t('brief.viewAllTasks')}
        </Button>
      }
    >
      <Flexbox gap={12}>
        {briefs.map((brief) => (
          <BriefCard brief={brief} key={brief.id} />
        ))}
        <Recommendations />
      </Flexbox>
      {briefs.length > 0 && (
        <>
          <DocumentPreviewModal />
          <TopicChatDrawer />
        </>
      )}
    </GroupBlock>
  );
});

export default DailyBrief;
