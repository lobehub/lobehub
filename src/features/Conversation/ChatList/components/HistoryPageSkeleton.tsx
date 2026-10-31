'use client';

import { memo } from 'react';

import { delayed } from '@/components/Skeleton/Delayed';

import SkeletonList from '../../components/SkeletonList';
import { useConversationStore } from '../../store';

export type HistoryPageSide = 'earlier' | 'later';

/**
 * The conversation skeleton shown beside the messages while a page of history
 * is in flight: above them for earlier history, below them for the later
 * rounds of a forward transcript. Held back like a route fallback, so a page
 * that lands quickly never flashes a block of skeleton over the messages.
 *
 * It subscribes to the loading flag itself instead of taking it as a prop:
 * virtua caches the element it rendered for an unchanged row, so the slot row
 * would never repaint on a flag change passed down from the list.
 */
const HistoryPageSkeleton = memo<{ side: HistoryPageSide }>(({ side }) => {
  const isLoading = useConversationStore((s) =>
    side === 'earlier' ? s.isLoadingEarlierMessages : s.isLoadingLaterMessages,
  );

  return isLoading ? delayed(<SkeletonList />) : null;
});

HistoryPageSkeleton.displayName = 'HistoryPageSkeleton';

export default HistoryPageSkeleton;
