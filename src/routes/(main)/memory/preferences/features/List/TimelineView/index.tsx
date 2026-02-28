'use client';

import { memo } from 'react';

import { type DisplayPreferenceMemory } from '@/database/repositories/userMemory';
import { useUserMemoryStore } from '@/store/userMemory';

import { TimelineView as GenericTimelineView } from '../../../../features/TimeLineView';
import { PeriodHeader, TimelineItemWrapper } from '../../../../features/TimeLineView/PeriodGroup';
import PreferenceCard from './PreferenceCard';

interface PreferenceTimelineViewProps {
  isLoading?: boolean;
  onClick?: (preference: DisplayPreferenceMemory) => void;
  preferences: DisplayPreferenceMemory[];
}

const PreferenceTimelineView = memo<PreferenceTimelineViewProps>(
  ({ preferences, isLoading, onClick }) => {
    const loadMorePreferences = useUserMemoryStore((s) => s.loadMorePreferences);
    const preferencesHasMore = useUserMemoryStore((s) => s.preferencesHasMore);

    return (
      <GenericTimelineView
        data={preferences}
        groupBy="day"
        hasMore={preferencesHasMore}
        isLoading={isLoading}
        renderHeader={(periodKey) => <PeriodHeader groupBy="day" periodKey={periodKey} />}
        renderItem={(preference) => (
          <TimelineItemWrapper>
            <PreferenceCard preference={preference} onClick={() => onClick?.(preference)} />
          </TimelineItemWrapper>
        )}
        onLoadMore={loadMorePreferences}
      />
    );
  },
);

export default PreferenceTimelineView;
