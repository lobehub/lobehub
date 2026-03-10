'use client';

import { type ActivityListItem } from '@lobechat/types';
import { memo } from 'react';

import { useUserMemoryStore } from '@/store/userMemory';

import { TimelineView as GenericTimelineView } from '../../../../features/TimeLineView';
import { PeriodHeader, TimelineItemWrapper } from '../../../../features/TimeLineView/PeriodGroup';
import ActivityCard from './ActivityCard';

interface ActivityTimelineViewProps {
  activities: ActivityListItem[];
  isLoading?: boolean;
  onCardClick: (activity: ActivityListItem) => void;
}

const ActivityTimelineView = memo<ActivityTimelineViewProps>(
  ({ activities, isLoading, onCardClick }) => {
    const loadMoreActivities = useUserMemoryStore((s) => s.loadMoreActivities);
    const activitiesHasMore = useUserMemoryStore((s) => s.activitiesHasMore);

    return (
      <GenericTimelineView
        data={activities}
        groupBy="day"
        hasMore={activitiesHasMore}
        isLoading={isLoading}
        renderHeader={(periodKey: string) => <PeriodHeader groupBy="day" periodKey={periodKey} />}
        renderItem={(activity: ActivityListItem) => (
          <TimelineItemWrapper>
            <ActivityCard activity={activity} onClick={onCardClick} />
          </TimelineItemWrapper>
        )}
        onLoadMore={loadMoreActivities}
      />
    );
  },
);

export default ActivityTimelineView;
