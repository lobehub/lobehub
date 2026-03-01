'use client';

import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useEffect, useRef } from 'react';
import { type VListHandle } from 'virtua';
import { VList } from 'virtua';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import TopicEmpty from '@/features/TopicEmpty';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import TopicItem from '../List/Item';

const ITEM_HEIGHT = 44; // Each topic item height

interface ContentProps {
  open: boolean;
  searchKeyword: string;
}

const Content = memo<ContentProps>(({ open, searchKeyword }) => {
  const virtuaRef = useRef<VListHandle>(null);
  const fetchedCountRef = useRef(-1);
  const initializedRef = useRef(false);

  const [
    activeTopicId,
    activeThreadId,
    hasMore,
    isLoadingMore,
    isExpandingPageSize,
    loadMoreTopics,
    activeAgentId,
    useSearchTopics,
  ] = useChatStore((s) => [
    s.activeTopicId,
    s.activeThreadId,
    topicSelectors.hasMoreTopics(s),
    topicSelectors.isLoadingMoreTopics(s),
    topicSelectors.isExpandingPageSize(s),
    s.loadMoreTopics,
    s.activeAgentId,
    s.useSearchTopics,
  ]);

  // Use server-side search if there's a keyword
  const trimmedKeyword = searchKeyword.trim();
  const isSearching = trimmedKeyword.length > 0;

  // Set searching state and trigger search
  useEffect(() => {
    if (isSearching) {
      useChatStore.setState({ isSearchingTopic: true });
    } else {
      // Reset search results when clearing search
      useChatStore.setState({ isSearchingTopic: false, searchTopics: [] });
    }
  }, [isSearching]);

  // Only search when there's a keyword (pass undefined to disable SWR)
  // Note: searchTopics uses sessionId in the service, but agentId in the hook
  useSearchTopics(isSearching ? trimmedKeyword : undefined, {
    agentId: activeAgentId,
    groupId: undefined,
  });

  const searchResults = useChatStore(topicSelectors.searchTopics, isEqual);
  const allTopicList = useChatStore(topicSelectors.displayTopics, isEqual);
  const isSearchingTopic = useChatStore(topicSelectors.isSearchingTopic);

  // Use search results if searching, otherwise use regular list
  const activeTopicList = isSearching ? searchResults : allTopicList;
  const count = activeTopicList?.length || 0;

  // Initial load: calculate how many items needed to fill viewport
  useEffect(() => {
    if (!open || initializedRef.current || isLoadingMore || isSearching) return;

    const timer = setTimeout(() => {
      const ref = virtuaRef.current;
      if (!ref) return;

      const viewportSize = ref.viewportSize;
      const itemsNeeded = Math.ceil(viewportSize / ITEM_HEIGHT) + 3;

      // Mark as initialized
      initializedRef.current = true;

      // Calculate how many pages we need to load to fill screen
      if (count < itemsNeeded && hasMore) {
        fetchedCountRef.current = count;

        // Calculate pages needed and load once
        const itemsToLoad = itemsNeeded - count;
        const pagesNeeded = Math.ceil(itemsToLoad / 20); // Assume 20 items per page

        // Load the required pages
        const loadPages = async () => {
          for (let i = 0; i < pagesNeeded && hasMore; i++) {
            await loadMoreTopics();
          }
        };
        loadPages();
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [open, count, hasMore, loadMoreTopics, isLoadingMore]);

  // Reset initialized flag when drawer closes
  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
    }
  }, [open]);

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
      await loadMoreTopics();
    }
  }, [hasMore, loadMoreTopics, count, isSearching]);

  const showLoading = (isLoadingMore || isExpandingPageSize) && !isSearching;
  const showSearchLoading = isSearching && isSearchingTopic;

  // Show empty state when no topics
  if (count === 0 && !showLoading && !showSearchLoading) {
    return <TopicEmpty search={Boolean(searchKeyword)} />;
  }

  // Show loading when searching
  if (showSearchLoading) {
    return (
      <Flexbox gap={1} paddingBlock={1} paddingInline={4}>
        <SkeletonList rows={5} />
      </Flexbox>
    );
  }

  return (
    <VList
      bufferSize={typeof window !== 'undefined' ? window.innerHeight : 0}
      ref={virtuaRef}
      style={{ height: '100%' }}
      onScroll={handleScroll}
    >
      {activeTopicList?.map((topic) => (
        <Flexbox gap={1} key={topic.id} padding={'4px 8px'}>
          <TopicItem
            active={activeTopicId === topic.id}
            fav={topic.favorite}
            id={topic.id}
            threadId={activeThreadId}
            title={topic.title}
          />
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

Content.displayName = 'AllTopicsDrawerContent';

export default Content;
