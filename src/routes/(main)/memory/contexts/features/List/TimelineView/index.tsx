'use client';

import { memo } from 'react';

import { type DisplayContextMemory } from '@/database/repositories/userMemory';
import { useUserMemoryStore } from '@/store/userMemory';

import { TimelineView as GenericTimelineView } from '../../../../features/TimeLineView';
import { PeriodHeader, TimelineItemWrapper } from '../../../../features/TimeLineView/PeriodGroup';
import ContextCard from './ContextCard';

interface ContextTimelineViewProps {
  contexts: DisplayContextMemory[];
  isLoading?: boolean;
  onClick?: (context: DisplayContextMemory) => void;
}

const ContextTimelineView = memo<ContextTimelineViewProps>(({ contexts, isLoading, onClick }) => {
  const loadMoreContexts = useUserMemoryStore((s) => s.loadMoreContexts);
  const contextsHasMore = useUserMemoryStore((s) => s.contextsHasMore);

  return (
    <GenericTimelineView
      data={contexts}
      groupBy="day"
      hasMore={contextsHasMore}
      isLoading={isLoading}
      renderHeader={(periodKey) => <PeriodHeader groupBy="day" periodKey={periodKey} />}
      renderItem={(context) => (
        <TimelineItemWrapper>
          <ContextCard context={context} onClick={() => onClick?.(context)} />
        </TimelineItemWrapper>
      )}
      onLoadMore={loadMoreContexts}
    />
  );
});

export default ContextTimelineView;
