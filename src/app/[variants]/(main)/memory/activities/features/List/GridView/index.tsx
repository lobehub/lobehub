import { type ActivityListItem } from '@lobechat/types';
import { memo } from 'react';

import { useUserMemoryStore } from '@/store/userMemory';

import { GridView } from '../../../../features/GridView';
import ActivityCard from './ActivityCard';

interface GridViewProps {
  activities: ActivityListItem[];
  isLoading?: boolean;
  onClick: (activity: ActivityListItem) => void;
}

const ActivitiesGridView = memo<GridViewProps>(({ activities, isLoading, onClick }) => {
  const loadMoreActivities = useUserMemoryStore((s) => s.loadMoreActivities);
  const activitiesHasMore = useUserMemoryStore((s) => s.activitiesHasMore);

  return (
    <GridView
      hasMore={activitiesHasMore}
      isLoading={isLoading}
      items={activities}
      renderItem={(activity: ActivityListItem) => (
        <ActivityCard activity={activity} onClick={() => onClick(activity)} />
      )}
      onLoadMore={loadMoreActivities}
    />
  );
});

export default ActivitiesGridView;
