'use client';

import { groupTopicsByProject, groupTopicsByUpdatedTime } from '@lobechat/utils/client/topic';
import { Flexbox, Skeleton } from '@lobehub/ui';
import { memo, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import Loading from '@/components/Loading/BrandTextLoading';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { shinyTextStyles } from '@/styles/loading';
import type { ChatTopic } from '@/types/topic';

import BulkActionBar from './BulkActionBar';
import EmptyState from './EmptyState';
import Header from './Header';
import { useTopicsViewStore } from './store';
import Toolbar from './Toolbar';
import TopicGrid from './TopicGrid';
import TopicListView from './TopicListView';
import {
  getProjectLabel,
  matchesGroup,
  matchesStatus,
  matchesTimeRange,
  matchesTrigger,
  sortTopics,
} from './utils';

// Start small so users see infinite scroll kick in; each scroll-to-bottom
// triggers `loadMoreTopics` which appends another page into `topicDataMap`.
const PAGE_SIZE = 30;

const AgentTopics = memo(() => {
  const { t } = useTranslation('topic');
  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const useFetchTopics = useChatStore((s) => s.useFetchTopics);
  const useSearchTopics = useChatStore((s) => s.useSearchTopics);
  const loadMoreTopics = useChatStore((s) => s.loadMoreTopics);

  // Read directly from the topic map so `loadMoreTopics` appends are visible
  // here without waiting for SWR revalidation.
  const allTopics = useChatStore(topicSelectors.currentTopics);
  const hasMore = useChatStore(topicSelectors.hasMoreTopics);
  const isLoadingMore = useChatStore(topicSelectors.isLoadingMoreTopics);

  const reset = useTopicsViewStore((s) => s.reset);
  const search = useTopicsViewStore((s) => s.search);
  const status = useTopicsViewStore((s) => s.status);
  const groupIds = useTopicsViewStore((s) => s.groupIds);
  const triggers = useTopicsViewStore((s) => s.triggers);
  const timeRange = useTopicsViewStore((s) => s.timeRange);
  const sortBy = useTopicsViewStore((s) => s.sortBy);
  const groupBy = useTopicsViewStore((s) => s.groupBy);
  const viewMode = useTopicsViewStore((s) => s.viewMode);
  const setStatus = useTopicsViewStore((s) => s.setStatus);
  const setGroupIds = useTopicsViewStore((s) => s.setGroupIds);
  const setTriggers = useTopicsViewStore((s) => s.setTriggers);
  const setTimeRange = useTopicsViewStore((s) => s.setTimeRange);
  const setSearch = useTopicsViewStore((s) => s.setSearch);

  // Reset local view state when leaving the page so a fresh visit starts clean.
  useEffect(() => () => reset(), [reset]);

  const { isLoading } = useFetchTopics(true, {
    agentId: activeAgentId,
    pageSize: PAGE_SIZE,
  });

  const trimmedSearch = search.trim();
  const { data: searchResults } = useSearchTopics(
    trimmedSearch.length > 0 ? trimmedSearch : undefined,
    { agentId: activeAgentId },
  );

  const baseTopics: ChatTopic[] = useMemo(() => {
    if (trimmedSearch.length > 0) return searchResults ?? [];
    return allTopics ?? [];
  }, [trimmedSearch, searchResults, allTopics]);

  const filtered = useMemo(() => {
    const out = baseTopics.filter(
      (t) =>
        matchesStatus(t, status) &&
        matchesGroup(t, groupIds) &&
        matchesTrigger(t, triggers) &&
        matchesTimeRange(t, timeRange),
    );
    return sortTopics(out, sortBy);
  }, [baseTopics, status, groupIds, triggers, timeRange, sortBy]);

  // Search results are flat — grouping by time confuses the relevance order
  // returned by the BM25 keyword search.
  const isSearchMode = trimmedSearch.length > 0;
  const useGroups = groupBy !== 'none' && !isSearchMode;

  const renderGroups = useMemo(() => {
    if (!useGroups) return [{ children: filtered, id: 'all' }];
    if (groupBy === 'byProject') {
      const field: 'createdAt' | 'updatedAt' = sortBy === 'createdAt' ? 'createdAt' : 'updatedAt';
      return groupTopicsByProject(filtered, field);
    }
    return groupTopicsByUpdatedTime(filtered);
  }, [filtered, useGroups, groupBy, sortBy]);

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of baseTopics) {
      const wd = t.metadata?.workingDirectory;
      if (wd && !map.has(wd)) {
        map.set(wd, getProjectLabel(t) ?? wd);
      }
    }
    return Array.from(map, ([value, label]) => ({ label, value }));
  }, [baseTopics]);

  const totalAfterFilter = filtered.length;
  // 'active' is the default tab, so it doesn't count as a user-applied filter
  const hasActiveFilters =
    (status !== 'active' && status !== 'all') ||
    groupIds.length > 0 ||
    triggers.length > 0 ||
    timeRange !== 'all' ||
    trimmedSearch.length > 0;

  const clearFilters = () => {
    setStatus('active');
    setGroupIds([]);
    setTriggers([]);
    setTimeRange('all');
    setSearch('');
  };

  // Infinite scroll — observe a sentinel near the end of the list and pull
  // the next page when it enters the viewport. We intentionally skip this in
  // search mode (server returns a fixed top-N result set).
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isSearchMode) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !isLoadingMore) {
          void loadMoreTopics();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, isSearchMode, loadMoreTopics]);

  if (!activeAgentId) return <Loading debugId="AgentTopics" />;

  return (
    <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
      <Header agentId={activeAgentId} />
      <Flexbox
        flex={1}
        paddingBlock={20}
        paddingInline={24}
        style={{ minWidth: 0, overflowY: 'auto' }}
      >
        <Flexbox
          gap={16}
          style={{
            marginInline: 'auto',
            maxWidth: 1440,
            width: '100%',
          }}
        >
          <Toolbar projects={projects} />
          <BulkActionBar />
          {isLoading && baseTopics.length === 0 ? (
            <Skeleton active paragraph={{ rows: 6 }} title={false} />
          ) : totalAfterFilter === 0 ? (
            <EmptyState
              agentId={activeAgentId}
              hasFilters={hasActiveFilters}
              onClearFilters={clearFilters}
            />
          ) : viewMode === 'card' ? (
            <TopicGrid
              agentId={activeAgentId}
              groupBy={groupBy}
              groups={renderGroups}
              showGroupTitles={useGroups}
            />
          ) : (
            <TopicListView
              agentId={activeAgentId}
              groupBy={groupBy}
              groups={renderGroups}
              showGroupTitles={useGroups}
            />
          )}
          {!isSearchMode && hasMore && <div aria-hidden ref={sentinelRef} style={{ height: 1 }} />}
          {!isSearchMode && isLoadingMore && (
            <Flexbox align={'center'} paddingBlock={12}>
              <span className={shinyTextStyles.shinyText} style={{ fontSize: 12 }}>
                {t('management.loadingMore')}
              </span>
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

AgentTopics.displayName = 'AgentTopics';

export default AgentTopics;
