import { type IdentityListItem } from '@lobechat/types';
import { memo } from 'react';

import { useUserMemoryStore } from '@/store/userMemory';

import { GridView } from '../../../../features/GridView';
import IdentityCard from './IdentityCard';

interface GridViewProps {
  identities: IdentityListItem[];
  isLoading?: boolean;
  onClick?: (identity: IdentityListItem) => void;
}

const IdentityGridView = memo<GridViewProps>(({ identities, isLoading, onClick }) => {
  const loadMoreIdentities = useUserMemoryStore((s) => s.loadMoreIdentities);
  const identitiesHasMore = useUserMemoryStore((s) => s.identitiesHasMore);

  return (
    <GridView
      hasMore={identitiesHasMore}
      isLoading={isLoading}
      items={identities}
      renderItem={(identity) => (
        <IdentityCard identity={identity} onClick={() => onClick?.(identity)} />
      )}
      onLoadMore={loadMoreIdentities}
    />
  );
});

export default IdentityGridView;
