'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { memo, useEffect, useMemo } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useChatStore } from '@/store/chat';
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

const PAGE_SIZE = 100;

const AgentTopics = memo(() => {
  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const useFetchTopics = useChatStore((s) => s.useFetchTopics);
  const useSearchTopics = useChatStore((s) => s.useSearchTopics);

  const reset = useTopicsViewStore((s) => s.reset);
  const search = useTopicsViewStore((s) => s.search);
  const status = useTopicsViewStore((s) => s.status);
  const groupIds = useTopicsViewStore((s) => s.groupIds);
  const triggers = useTopicsViewStore((s) => s.triggers);
  const timeRange = useTopicsViewStore((s) => s.timeRange);
  const sortBy = useTopicsViewStore((s) => s.sortBy);
  const viewMode = useTopicsViewStore((s) => s.viewMode);
  const setStatus = useTopicsViewStore((s) => s.setStatus);
  const setGroupIds = useTopicsViewStore((s) => s.setGroupIds);
  const setTriggers = useTopicsViewStore((s) => s.setTriggers);
  const setTimeRange = useTopicsViewStore((s) => s.setTimeRange);
  const setSearch = useTopicsViewStore((s) => s.setSearch);

  // Reset local view state when leaving the page so a fresh visit starts clean.
  useEffect(() => () => reset(), [reset]);

  const { data: fetched, isLoading } = useFetchTopics(true, {
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
    return fetched?.items ?? [];
  }, [trimmedSearch, searchResults, fetched]);

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
  const hasActiveFilters =
    status !== 'all' ||
    groupIds.length > 0 ||
    triggers.length > 0 ||
    timeRange !== 'all' ||
    trimmedSearch.length > 0;

  const clearFilters = () => {
    setStatus('all');
    setGroupIds([]);
    setTriggers([]);
    setTimeRange('all');
    setSearch('');
  };

  if (!activeAgentId) return <Loading debugId="AgentTopics" />;

  return (
    <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
      <Header agentId={activeAgentId} total={fetched?.total ?? 0} />
      <WideScreenContainer gap={16} paddingBlock={20} wrapperStyle={{ flex: 1, overflowY: 'auto' }}>
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
          <TopicGrid agentId={activeAgentId} topics={filtered} />
        ) : (
          <TopicListView agentId={activeAgentId} topics={filtered} />
        )}
      </WideScreenContainer>
    </Flexbox>
  );
});

AgentTopics.displayName = 'AgentTopics';

export default AgentTopics;
