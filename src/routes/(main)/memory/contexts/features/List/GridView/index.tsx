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
  // Load-more progress / failure of the query on screen (footer + retry).
  const isLoadingMore = useUserMemoryStore((s) => Boolean(s.contextListData?.isLoadingMore));
  const loadMoreError = useUserMemoryStore((s) => s.contextListData?.loadMoreError);

  return (
    <GridView
      defaultColumnCount={2}
      hasMore={contextsHasMore}
      isLoading={isLoading || isLoadingMore}
      items={contexts}
      loadMoreError={loadMoreError}
      renderItem={(context) => <ContextCard context={context} onClick={() => onClick(context)} />}
      onLoadMore={loadMoreContexts}
    />
  );
});

export default ContextsGridView;
