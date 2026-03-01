import { memo } from 'react';

import { type DisplayContextMemory } from '@/database/repositories/userMemory';
import { useUserMemoryStore } from '@/store/userMemory';

import { GridView } from '../../../../features/GridView';
import ContextCard from './ContextCard';

interface GridViewProps {
  contexts: DisplayContextMemory[];
  isLoading?: boolean;
  onClick: (context: DisplayContextMemory) => void;
}

const ContextsGridView = memo<GridViewProps>(({ contexts, isLoading, onClick }) => {
  const loadMoreContexts = useUserMemoryStore((s) => s.loadMoreContexts);
  const contextsHasMore = useUserMemoryStore((s) => s.contextsHasMore);

  return (
    <GridView
      defaultColumnCount={2}
      hasMore={contextsHasMore}
      isLoading={isLoading}
      items={contexts}
      renderItem={(context) => <ContextCard context={context} onClick={() => onClick(context)} />}
      onLoadMore={loadMoreContexts}
    />
  );
});

export default ContextsGridView;
