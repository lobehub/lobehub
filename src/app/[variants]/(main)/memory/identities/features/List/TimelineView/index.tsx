import type { IdentityListItem } from '@lobechat/types';
import { memo } from 'react';

import { useUserMemoryStore } from '@/store/userMemory';

import { TimelineView as GenericTimelineView } from '../../../../features/TimeLineView';
import { PeriodHeader, TimelineItemWrapper } from '../../../../features/TimeLineView/PeriodGroup';
import IdentityCard from './IdentityCard';

interface TimelineViewProps {
  identities: IdentityListItem[];
  isLoading?: boolean;
  onClick?: (identity: IdentityListItem) => void;
}

const TimelineView = memo<TimelineViewProps>(({ identities, isLoading, onClick }) => {
  const loadMoreIdentities = useUserMemoryStore((s) => s.loadMoreIdentities);
  const identitiesHasMore = useUserMemoryStore((s) => s.identitiesHasMore);

  return (
    <GenericTimelineView
      data={identities}
      getDateForGrouping={(identity) =>
        identity.episodicDate || identity.capturedAt || identity.createdAt
      }
      groupBy="month"
      hasMore={identitiesHasMore}
      isLoading={isLoading}
      onLoadMore={loadMoreIdentities}
      renderHeader={(periodKey) => <PeriodHeader groupBy="month" periodKey={periodKey} />}
      renderItem={(identity) => (
        <TimelineItemWrapper>
          <IdentityCard identity={identity} onClick={() => onClick?.(identity)} />
        </TimelineItemWrapper>
      )}
    />
  );
});

export default TimelineView;
