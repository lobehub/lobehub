import { type IdentityListItem } from '@lobechat/types';
import { memo } from 'react';

import { identitySelectors, useUserMemoryStore } from '@/store/userMemory';

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
  const identitiesHasMore = useUserMemoryStore(identitySelectors.identitiesHasMore);
  const isLoadingMore = useUserMemoryStore(identitySelectors.identitiesIsLoadingMore);
  const loadMoreError = useUserMemoryStore(identitySelectors.identitiesLoadMoreError);

  return (
    <GenericTimelineView
      data={identities}
      groupBy="month"
      hasMore={identitiesHasMore}
      isLoading={isLoading || isLoadingMore}
      loadMoreError={loadMoreError}
      renderHeader={(periodKey) => <PeriodHeader groupBy="month" periodKey={periodKey} />}
      getDateForGrouping={(identity) =>
        identity.episodicDate || identity.capturedAt || identity.createdAt
      }
      renderItem={(identity) => (
        <TimelineItemWrapper>
          <IdentityCard identity={identity} onClick={() => onClick?.(identity)} />
        </TimelineItemWrapper>
      )}
      onLoadMore={loadMoreIdentities}
    />
  );
});

export default TimelineView;
