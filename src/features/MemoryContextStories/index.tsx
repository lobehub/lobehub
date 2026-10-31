'use client';

import { type MemoryContextStoryList } from '@lobechat/types';
import { Center, Empty } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { LayersIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import MemoryEntities from '@/features/MemoryEntities';
import { ErrorState, LoadingState } from '@/features/MemoryEntities/states';
import { useUserMemoryStore } from '@/store/userMemory';

import { groupStories } from './derive';
import LegacyView from './LegacyView';
import StoryList from './List';
import StoryPage from './Page';
import { PageSkeleton } from './states';
import { useStoryView } from './useStoryView';

const styles = stylex.create({
  root: { display: 'flex', height: '100%', width: '100%' },
});

/**
 * The page of one story; `fallback` renders when the id is not a consolidated context (a deep
 * link to a per-topic context).
 */
const StoryPane = memo<{ contextId: string; fallback?: boolean }>(({ contextId, fallback }) => {
  const { t } = useTranslation('memory');
  const { error, isLoading, mutate } = useUserMemoryStore((s) => s.useFetchContextStory)(contextId);
  const story = useUserMemoryStore((s) => s.contextStoryMap[contextId]);

  if (story) return <StoryPage story={story} />;
  if (isLoading || (story === undefined && !error)) return <PageSkeleton />;
  if (error) return <ErrorState onRetry={() => mutate()} />;
  if (fallback) return <MemoryEntities />;
  // Gone since the list loaded (e.g. a reverted run): ask for another pick.
  return (
    <Center flex={1}>
      <Empty description={t('entity.list.pick')} icon={LayersIcon} />
    </Center>
  );
});

StoryPane.displayName = 'StoryPane';

/** With nothing picked, open the story that moved most recently, ongoing ones first. */
const defaultStoryId = (list: MemoryContextStoryList) =>
  groupStories(list.stories).find((g) => g.stories.length > 0)?.stories[0]?.id;

/**
 * Memory → 情境. Users whose memory was organized see their contexts as stories (context →
 * dossiers → records): a list on the left, the open story on the right. Everyone else keeps the
 * per-topic context pages.
 */
const MemoryContextStories = memo(() => {
  const view = useStoryView();
  const { error, isLoading, mutate } = useUserMemoryStore((s) => s.useFetchContextStories)();
  const list = useUserMemoryStore((s) => s.contextStoryList);
  const fallbackId = useMemo(() => (list ? defaultStoryId(list) : undefined), [list]);

  let content;
  if (!list && isLoading) content = <LoadingState />;
  else if (!list && error) content = <ErrorState onRetry={() => mutate()} />;
  // Never organized: the per-topic pages are all there is.
  else if (!list || list.stories.length === 0) content = <MemoryEntities />;
  else if (view.legacy) content = <LegacyView onBack={view.closeLegacy} />;
  // A deep link to a per-topic context: the legacy page shows it if it is not a story after all.
  else if (view.contextId && !list.stories.some((s) => s.id === view.contextId))
    content = <StoryPane fallback contextId={view.contextId} />;
  else {
    const selectedId = view.contextId ?? fallbackId;
    content = (
      <>
        <StoryList
          data={list}
          selectedId={selectedId}
          onOpenLegacy={view.openLegacy}
          onSelect={view.select}
        />
        {selectedId && <StoryPane contextId={selectedId} key={selectedId} />}
      </>
    );
  }

  return <div {...stylex.props(styles.root)}>{content}</div>;
});

MemoryContextStories.displayName = 'MemoryContextStories';

export default MemoryContextStories;
