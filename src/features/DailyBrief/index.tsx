import { Button, Flexbox } from '@lobehub/ui';
import { Newspaper } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import TopicChatDrawer from '@/features/AgentTasks/AgentTaskDetail/TopicChatDrawer';
import DocumentPreviewModal from '@/features/DocumentModal/Preview';
import Recommendations, { useRecommendationsVisible } from '@/features/Recommendations';
import GroupBlock from '@/routes/(main)/home/features/components/GroupBlock';
import { useBriefStore } from '@/store/brief';
import { briefListSelectors } from '@/store/brief/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import BriefCard from './BriefCard';
import { BriefCardSkeleton } from './BriefCardSkeleton';

const DailyBrief = memo(() => {
  const { t } = useTranslation('home');
  const navigate = useNavigate();
  const isLogin = useUserStore(authSelectors.isLogin);
  const useFetchBriefs = useBriefStore((s) => s.useFetchBriefs);
  useFetchBriefs(isLogin);

  const briefs = useBriefStore(briefListSelectors.briefs);
  const isInit = useBriefStore(briefListSelectors.isBriefsInit);
  const recommendationsVisible = useRecommendationsVisible();

  if (!isLogin) return null;

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

  if (briefs.length === 0 && !recommendationsVisible) return null;

  const showViewAllTasks = briefs.length > 0 || recommendationsVisible;

  return (
    <GroupBlock
      actionAlwaysVisible={showViewAllTasks}
      icon={Newspaper}
      title={t('brief.title')}
      action={
        showViewAllTasks ? (
          <Button size={'small'} type={'text'} onClick={() => navigate('/tasks')}>
            {t('brief.viewAllTasks')}
          </Button>
        ) : undefined
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
