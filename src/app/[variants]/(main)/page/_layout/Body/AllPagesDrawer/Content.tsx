'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useCallback, useMemo, useRef } from 'react';
import { VList, type VListHandle } from 'virtua';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import PageEmpty from '@/features/PageEmpty';
import { documentSelectors, useFileStore } from '@/store/file';
import { type LobeDocument } from '@/types/document';

import Item from '../List/Item';

interface ContentProps {
  searchKeyword: string;
}

const Content = memo<ContentProps>(({ searchKeyword }) => {
  const virtuaRef = useRef<VListHandle>(null);
  const fetchedCountRef = useRef(-1);

  const [hasMore, isLoadingMore, loadMoreDocuments] = useFileStore((s) => [
    documentSelectors.hasMoreDocuments(s),
    documentSelectors.isLoadingMoreDocuments(s),
    s.loadMoreDocuments,
  ]);

  const allFilteredPages = useFileStore(documentSelectors.getFilteredPages);

  // Filter by search keyword
  const displayPages = useMemo(() => {
    if (!searchKeyword.trim()) return allFilteredPages;

    const keyword = searchKeyword.toLowerCase();
    return allFilteredPages.filter((page: LobeDocument) => {
      const content = page.content?.toLowerCase() || '';
      const title = page.title?.toLowerCase() || '';
      return content.includes(keyword) || title.includes(keyword);
    });
  }, [allFilteredPages, searchKeyword]);

  const count = displayPages.length;
  const isSearching = searchKeyword.trim().length > 0;

  // Handle scroll - use findItemIndex (official pattern)
  const handleScroll = useCallback(async () => {
    // Don't load more when searching
    if (isSearching) return;

    const ref = virtuaRef.current;
    if (!ref || !hasMore) return;

    // Use findItemIndex to detect scroll position
    const bottomVisibleIndex = ref.findItemIndex(ref.scrollOffset + ref.viewportSize);

    // When scrolled near the end (within 5 items), load more
    if (fetchedCountRef.current < count && bottomVisibleIndex + 5 > count) {
      fetchedCountRef.current = count;
      await loadMoreDocuments();
    }
  }, [hasMore, loadMoreDocuments, count, isSearching]);

  const showLoading = isLoadingMore && !isSearching;

  // Show empty state
  if (count === 0) {
    return <PageEmpty search={isSearching} />;
  }

  return (
    <VList
      bufferSize={typeof window !== 'undefined' ? window.innerHeight : 0}
      onScroll={handleScroll}
      ref={virtuaRef}
      style={{ height: '100%' }}
    >
      {displayPages.map((page) => (
        <Flexbox gap={1} key={page.id} padding={'4px 8px'}>
          <Item pageId={page.id} />
        </Flexbox>
      ))}
      {showLoading && (
        <Flexbox padding={'4px 8px'}>
          <SkeletonList rows={3} />
        </Flexbox>
      )}
    </VList>
  );
});

Content.displayName = 'AllPagesDrawerContent';

export default Content;
