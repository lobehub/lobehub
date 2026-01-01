import { memo } from 'react';

import { type DisplayIdentityMemory } from '@/database/repositories/userMemory';
import { useUserMemoryStore } from '@/store/userMemory';

import { GridView } from '../../../../features/GridView';
import IdentityCard from './IdentityCard';

interface GridViewProps {
  identities: DisplayIdentityMemory[];
  isLoading?: boolean;
  onClick?: (identity: DisplayIdentityMemory) => void;
}

const IdentityGridView = memo<GridViewProps>(({ identities, isLoading, onClick }) => {
  const loadMoreIdentities = useUserMemoryStore((s) => s.loadMoreIdentities);
  const identitiesHasMore = useUserMemoryStore((s) => s.identitiesHasMore);

  return (
    <GridView
      hasMore={identitiesHasMore}
      isLoading={isLoading}
      items={identities}
      onLoadMore={loadMoreIdentities}
      renderItem={(identity) => (
        <IdentityCard identity={identity} onClick={() => onClick?.(identity)} />
      )}
    />
  );
});

export default IdentityGridView;
