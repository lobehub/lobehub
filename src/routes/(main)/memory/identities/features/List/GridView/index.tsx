import { type IdentityListItem } from '@lobechat/types';
import { memo } from 'react';

import { identitySelectors, useUserMemoryStore } from '@/store/userMemory';

import { GridView } from '../../../../features/GridView';
import IdentityCard from './IdentityCard';

interface GridViewProps {
  identities: IdentityListItem[];
  isLoading?: boolean;
  onClick?: (identity: IdentityListItem) => void;
}

const IdentityGridView = memo<GridViewProps>(({ identities, isLoading, onClick }) => {
  const loadMoreIdentities = useUserMemoryStore((s) => s.loadMoreIdentities);
  const identitiesHasMore = useUserMemoryStore(identitySelectors.identitiesHasMore);
  const isLoadingMore = useUserMemoryStore(identitySelectors.identitiesIsLoadingMore);
  const loadMoreError = useUserMemoryStore(identitySelectors.identitiesLoadMoreError);

  return (
    <GridView
      hasMore={identitiesHasMore}
      isLoading={isLoading || isLoadingMore}
      items={identities}
      loadMoreError={loadMoreError}
      renderItem={(identity) => (
        <IdentityCard identity={identity} onClick={() => onClick?.(identity)} />
      )}
      onLoadMore={loadMoreIdentities}
    />
  );
});

export default IdentityGridView;
