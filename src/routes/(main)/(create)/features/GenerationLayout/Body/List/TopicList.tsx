'use client';

import { Grid, TooltipGroup } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import TopicItem from './Item';
import { useGenerationTopicContext } from './StoreContext';

interface TopicListProps {
  viewMode?: 'auto' | 'grid' | 'list';
  visibility?: 'private' | 'public';
}

const TopicsList = memo<TopicListProps>(({ viewMode = 'auto', visibility }) => {
  const { useStore, namespace } = useGenerationTopicContext();
  const { t } = useTranslation(namespace);
  const openNewGenerationTopic = useStore((s: any) => s.openNewGenerationTopic);
  const setNewGenerationTopicVisibility = useStore((s: any) => s.setNewGenerationTopicVisibility);
  const isLogin = useUserStore(authSelectors.isLogin);
  const useFetchGenerationTopics = useStore((s) => s.useFetchGenerationTopics);
  useFetchGenerationTopics(!!isLogin);
  const generationTopics = useStore((s) => s.generationTopics);
  const filteredTopics =
    visibility === 'private'
      ? generationTopics.filter((topic) => topic.visibility === 'private')
      : visibility === 'public'
        ? generationTopics.filter((topic) => topic.visibility !== 'private')
        : generationTopics;

  const isList = viewMode === 'list';

  const isEmpty = !filteredTopics || filteredTopics.length === 0;

  const handleCreate = () => {
    if (visibility) setNewGenerationTopicVisibility(visibility);
    openNewGenerationTopic();
  };

  if (isEmpty) {
    return <EmptyNavItem title={t('topic.createNew')} onClick={handleCreate} />;
  }

  const content = filteredTopics.map((topic) => (
    <TopicItem key={topic.id} showMoreInfo={isList} topic={topic} />
  ));

  return (
    <>
      {isList ? (
        content
      ) : (
        <TooltipGroup layoutAnimation>
          <Grid gap={4} maxItemWidth={64} padding={6} rows={6} width={'100%'}>
            {content}
          </Grid>
        </TooltipGroup>
      )}
    </>
  );
});

TopicsList.displayName = 'TopicsList';

export default TopicsList;
