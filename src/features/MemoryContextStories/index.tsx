'use client';

import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import MemoryEntities from '@/features/MemoryEntities';
import { ErrorState } from '@/features/MemoryEntities/states';
import { useUserMemoryStore } from '@/store/userMemory';

import LegacyView from './LegacyView';
import StoryPage from './Page';
import { PageSkeleton, WallSkeleton } from './states';
import { useStoryView } from './useStoryView';
import StoryWall from './Wall';

const styles = stylex.create({
  root: { display: 'flex', height: '100%', width: '100%' },
});

/** The story page of `?contextId=`; a legacy context id falls through to the legacy page. */
const StoryRoute = memo<{ contextId: string; onBack: () => void }>(({ contextId, onBack }) => {
  const { error, isLoading, mutate } = useUserMemoryStore((s) => s.useFetchContextStory)(contextId);
  const story = useUserMemoryStore((s) => s.contextStoryMap[contextId]);

  if (story) return <StoryPage story={story} onBack={onBack} />;
  if (isLoading || (story === undefined && !error)) return <PageSkeleton />;
  if (error) return <ErrorState onRetry={() => mutate()} />;
  // Not a consolidated context: a deep link to a per-topic context keeps working.
  return <MemoryEntities />;
});

StoryRoute.displayName = 'StoryRoute';

/**
 * Memory → 情境. Users whose memory was organized see their contexts as stories (context →
 * dossiers → records); everyone else keeps the per-topic context pages.
 */
const MemoryContextStories = memo(() => {
  const view = useStoryView();
  const { error, isLoading, mutate } = useUserMemoryStore((s) => s.useFetchContextStories)();
  const list = useUserMemoryStore((s) => s.contextStoryList);

  let content;
  if (view.contextId) content = <StoryRoute contextId={view.contextId} onBack={view.openWall} />;
  else if (!list && isLoading) content = <WallSkeleton />;
  else if (!list && error) content = <ErrorState onRetry={() => mutate()} />;
  // Never organized: the per-topic pages are all there is.
  else if (!list || list.stories.length === 0) content = <MemoryEntities />;
  else if (view.legacy) content = <LegacyView onBack={view.closeLegacy} />;
  else content = <StoryWall data={list} onOpen={view.open} onOpenLegacy={view.openLegacy} />;

  return <div {...stylex.props(styles.root)}>{content}</div>;
});

MemoryContextStories.displayName = 'MemoryContextStories';

export default MemoryContextStories;
