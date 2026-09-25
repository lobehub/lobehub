'use client';

import { memo } from 'react';

import SkeletonList from '../../components/SkeletonList';
import { useConversationStore } from '../../store';

/**
 * The conversation skeleton shown above the messages while a page of
 * pre-window history is in flight.
 *
 * It subscribes to the loading flag itself instead of taking it as a prop:
 * virtua caches the element it rendered for an unchanged row, so the leading
 * row would never repaint on a flag change passed down from the list.
 */
const EarlierHistorySkeleton = memo(() => {
  const isLoading = useConversationStore((s) => s.isLoadingEarlierMessages);

  return isLoading ? <SkeletonList /> : null;
});

EarlierHistorySkeleton.displayName = 'EarlierHistorySkeleton';

export default EarlierHistorySkeleton;
