'use client';

import {
  getTopicWorkingDirectorySourcePath,
  groupTopicsByProject,
  groupTopicsByUpdatedTime,
} from '@lobechat/utils/client/topic';
import { Flexbox } from '@lobehub/ui';
import { memo, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import TopicsSkeleton from '@/components/Skeleton/Topics';
import { useChannelsEnabled } from '@/features/Channels/useChannelsEnabled';
import { useLocalMachineDeviceIds } from '@/hooks/useLocalMachineDeviceIds';
import { channelActions, channelSelectors, useChannelStore } from '@/store/channel';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { shinyTextStyles } from '@/styles/loading';
import type { ChatTopic } from '@/types/topic';

import BulkActionBar from './BulkActionBar';
import ChannelSection from './ChannelSection';
import EmptyState from './EmptyState';
import Header from './Header';
import ShareVisitorSection from './ShareVisitorSection';
import { useTopicsViewStore } from './store';
import Toolbar from './Toolbar';
import TopicGrid from './TopicGrid';
import TopicListView from './TopicListView';
import type { StatusFilter } from './types';
import { useShareVisitors } from './useShareVisitors';
import {
  agentGroupChannels,
  buildBotChannelOptions,
  channelListState,
  getProjectFilterLabel,
  matchesBotChannel,
  matchesChannelSearch,
  matchesChannelStatus,
  matchesGroup,
  matchesShareVisitorSearch,
  matchesShareVisitorStatus,
  matchesStatus,
  matchesTimeRange,
  matchesTrigger,
  sortChannelsBy,
  sortShareVisitorsBy,
  sortTopics,
} from './utils';

// Start small so users see infinite scroll kick in; each scroll-to-bottom
// triggers `loadMoreTopics` which appends another page into `topicDataMap`.
const PAGE_SIZE = 30;

const AgentTopicManager = memo(() => {
  const { t } = useTranslation('topic');
  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const localDeviceIds = useLocalMachineDeviceIds();
  // Use the management page's dedicated SWR pipeline so the heavier
  // `withDetails` fetch doesn't share a bucket with the sidebar's cheap
  // fetch (the shared bucket let whichever response landed last clobber the
  // other).
  const useFetchAgentTopicsView = useChatStore((s) => s.useFetchAgentTopicsView);
  const useSearchTopics = useChatStore((s) => s.useSearchTopics);
  const loadMoreAgentTopicsView = useChatStore((s) => s.loadMoreAgentTopicsView);

  // Read directly from the view's topic map so `loadMore` appends are visible
  // here without waiting for SWR revalidation.
  const allTopics = useChatStore(topicSelectors.agentTopicsViewTopics);
  const hasMore = useChatStore(topicSelectors.agentTopicsViewHasMore);
  const isLoadingMore = useChatStore(topicSelectors.agentTopicsViewIsLoadingMore);
  const loadMoreError = useChatStore(topicSelectors.agentTopicsViewLoadMoreError);

  const reset = useTopicsViewStore((s) => s.reset);
  const search = useTopicsViewStore((s) => s.search);
  const status = useTopicsViewStore((s) => s.status);
  const groupIds = useTopicsViewStore((s) => s.groupIds);
  const triggers = useTopicsViewStore((s) => s.triggers);
  const botChannels = useTopicsViewStore((s) => s.botChannels);
  const timeRange = useTopicsViewStore((s) => s.timeRange);
  const sortBy = useTopicsViewStore((s) => s.sortBy);
  const groupBy = useTopicsViewStore((s) => s.groupBy);
  const viewMode = useTopicsViewStore((s) => s.viewMode);
  const setStatus = useTopicsViewStore((s) => s.setStatus);
  const setGroupIds = useTopicsViewStore((s) => s.setGroupIds);
  const setTriggers = useTopicsViewStore((s) => s.setTriggers);
  const setBotChannels = useTopicsViewStore((s) => s.setBotChannels);
  const setTimeRange = useTopicsViewStore((s) => s.setTimeRange);
  const setSearch = useTopicsViewStore((s) => s.setSearch);

  // Reset whenever the agent context switches AND on unmount. The route
  // `/agent/:aid/topics` reuses the same component instance across agent
  // navigations, so an unmount-only cleanup would let `selectedIds` (and
  // other view state) from the previous agent persist into the next one —
  // which would mean a bulk Delete/Archive/Favorite click silently targets
  // stale IDs from another agent.
  useEffect(() => {
    reset();
  }, [activeAgentId, reset]);

  const { error, isHydrated, isValidating, revalidate } = useFetchAgentTopicsView(true, {
    agentId: activeAgentId,
    pageSize: PAGE_SIZE,
    // Opt into the heavier card-detail columns (firstUserMessage,
    // messageCount, cost, tokenUsage, description, trigger). Sidebar paths
    // omit this so their query stays cheap.
    withDetails: true,
  });

  // Rows come from the store; the hook only reports fetch progress.
  const isLoading = !isHydrated || isValidating;

  // Channel conversations are listed as Channels: the Agent's run topics there stay hidden.
  const channelsEnabled = useChannelsEnabled();
  const showChannels = channelsEnabled && triggers.includes('channel');
  const channelSync = channelActions.useFetchList(showChannels);
  const allChannels = useChannelStore(channelSelectors.list);
  const { error: channelsError, loading: channelsLoading } = channelListState(
    showChannels,
    allChannels,
    channelSync.error,
  );
  const retryChannels = () => {
    void channelActions.refreshList().catch(() => {});
  };
  const shareVisitors = useShareVisitors(
    activeAgentId,
    channelsEnabled && triggers.includes('share'),
  );

  const trimmedSearch = search.trim();
  const { data: searchResults } = useSearchTopics(
    trimmedSearch.length > 0 ? trimmedSearch : undefined,
    { agentId: activeAgentId },
  );

  const baseTopics: ChatTopic[] = useMemo(() => {
    if (trimmedSearch.length > 0) return searchResults ?? [];
    return allTopics ?? [];
  }, [trimmedSearch, searchResults, allTopics]);

  // Pool with every filter EXCEPT status applied. Reused for the final
  // filtered list AND for the per-status count badges so each tab shows
  // "what you'd see if you switched here with the same other filters".
  const preStatusPool = useMemo(
    () =>
      baseTopics.filter(
        (t) =>
          matchesGroup(t, groupIds) &&
          matchesTrigger(t, triggers) &&
          matchesTimeRange(t, timeRange) &&
          matchesBotChannel(t, botChannels),
      ),
    [baseTopics, groupIds, triggers, timeRange, botChannels],
  );

  const filtered = useMemo(() => {
    const out = preStatusPool.filter((t) => matchesStatus(t, status));
    return sortTopics(out, sortBy);
  }, [preStatusPool, status, sortBy]);

  // Project and bot-platform filters describe topics only, so no Channel matches them.
  const channelPool = useMemo(
    () =>
      showChannels && activeAgentId && groupIds.length === 0 && botChannels.length === 0
        ? agentGroupChannels(allChannels, activeAgentId).filter(
            (channel) =>
              matchesChannelSearch(channel, trimmedSearch) && matchesTimeRange(channel, timeRange),
          )
        : [],
    [showChannels, activeAgentId, groupIds, botChannels, allChannels, trimmedSearch, timeRange],
  );

  const visibleChannels = useMemo(
    () =>
      sortChannelsBy(
        channelPool.filter((channel) => matchesChannelStatus(channel, status)),
        sortBy,
      ),
    [channelPool, status, sortBy],
  );

  // Project and bot-platform filters describe topics only, as for Channels.
  const shareVisitorPool = useMemo(
    () =>
      groupIds.length === 0 && botChannels.length === 0
        ? shareVisitors.conversations.filter(
            (conversation) =>
              matchesShareVisitorSearch(conversation, trimmedSearch) &&
              matchesTimeRange(conversation, timeRange),
          )
        : [],
    [shareVisitors.conversations, groupIds, botChannels, trimmedSearch, timeRange],
  );

  const visibleShareVisitors = useMemo(
    () => (matchesShareVisitorStatus(status) ? sortShareVisitorsBy(shareVisitorPool, sortBy) : []),
    [shareVisitorPool, status, sortBy],
  );

  const statusCounts = useMemo(() => {
    const count = (tab: StatusFilter) =>
      preStatusPool.filter((t) => matchesStatus(t, tab)).length +
      channelPool.filter((channel) => matchesChannelStatus(channel, tab)).length +
      (matchesShareVisitorStatus(tab) ? shareVisitorPool.length : 0);
    return {
      active: count('active'),
      all: count('all'),
      // 'archived' has no visible tab today, but StatusFilter still includes it
      // — count it so the Record satisfies the type for any future tab.
      archived: count('archived'),
      completed: count('completed'),
      running: count('running'),
    };
  }, [preStatusPool, channelPool, shareVisitorPool]);

  // Search results are flat — grouping by time confuses the relevance order
  // returned by the BM25 keyword search.
  const isSearchMode = trimmedSearch.length > 0;
  const useGroups = groupBy !== 'none' && !isSearchMode;

  const renderGroups = useMemo(() => {
    if (!useGroups) return [{ children: filtered, id: 'all' }];
    if (groupBy === 'byProject') {
      const field: 'createdAt' | 'updatedAt' = sortBy === 'createdAt' ? 'createdAt' : 'updatedAt';
      return groupTopicsByProject(filtered, field, { localDeviceIds });
    }
    return groupTopicsByUpdatedTime(filtered);
  }, [filtered, useGroups, groupBy, sortBy, localDeviceIds]);

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of baseTopics) {
      const wd = getTopicWorkingDirectorySourcePath(t);
      if (wd && !map.has(wd)) {
        map.set(wd, getProjectFilterLabel(t) ?? wd);
      }
    }
    return Array.from(map, ([value, label]) => ({ label, value }));
  }, [baseTopics]);

  const botChannelOptions = useMemo(() => buildBotChannelOptions(baseTopics), [baseTopics]);

  const totalAfterFilter = filtered.length;
  // 'active' is the default tab, so it doesn't count as a user-applied filter
  const hasActiveFilters =
    (status !== 'active' && status !== 'all') ||
    groupIds.length > 0 ||
    triggers.length > 0 ||
    botChannels.length > 0 ||
    timeRange !== 'all' ||
    trimmedSearch.length > 0;

  const clearFilters = () => {
    // "Clear filters" jumps to All so users can confirm there really is no
    // matching topic in the entire dataset; the default Active landing is
    // only for first visits.
    setStatus('all');
    setGroupIds([]);
    setTriggers([]);
    setBotChannels([]);
    setTimeRange('all');
    setSearch('');
  };

  // Infinite scroll — observe a sentinel near the end of the list. We pass
  // the scroll container as the IntersectionObserver `root` so detection is
  // tied to the in-page scroll position, not the window viewport (otherwise
  // a tall window can leave the sentinel "always intersecting" or never
  // intersecting, depending on layout).
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isSearchMode) return;
    const root = scrollContainerRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !isLoadingMore && !loadMoreError) {
          void loadMoreAgentTopicsView();
        }
      },
      { root, rootMargin: '300px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, isSearchMode, loadMoreAgentTopicsView, loadMoreError]);

  if (!activeAgentId) return <TopicsSkeleton />;

  return (
    <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
      <Header agentId={activeAgentId} />
      <div
        ref={scrollContainerRef}
        style={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          minWidth: 0,
          overflowY: 'auto',
          padding: '20px 24px',
        }}
      >
        <Flexbox
          gap={16}
          style={{
            marginInline: 'auto',
            maxWidth: 1440,
            width: '100%',
          }}
        >
          <Toolbar
            botChannelOptions={botChannelOptions}
            projects={projects}
            statusCounts={statusCounts}
          />
          <BulkActionBar topics={baseTopics} />
          {!isSearchMode && error && !isLoading && baseTopics.length === 0 ? (
            <AsyncError
              error={error}
              variant={'block'}
              onRetry={() => {
                void revalidate();
              }}
            />
          ) : (isLoading && baseTopics.length === 0) ||
            ((channelsLoading || shareVisitors.loading) && totalAfterFilter === 0) ? (
            <TopicsSkeleton chrome={'body'} />
          ) : channelsError && totalAfterFilter === 0 ? (
            <AsyncError error={channelsError} variant={'block'} onRetry={retryChannels} />
          ) : shareVisitors.error && totalAfterFilter === 0 && visibleChannels.length === 0 ? (
            <AsyncError
              error={shareVisitors.error}
              variant={'block'}
              onRetry={shareVisitors.retry}
            />
          ) : totalAfterFilter === 0 &&
            visibleChannels.length === 0 &&
            visibleShareVisitors.length === 0 ? (
            <EmptyState
              agentId={activeAgentId}
              hasFilters={hasActiveFilters}
              onClearFilters={clearFilters}
            />
          ) : (
            <>
              {channelsError ? (
                <AsyncError error={channelsError} variant={'inline'} onRetry={retryChannels} />
              ) : (
                <ChannelSection channels={visibleChannels} />
              )}
              {shareVisitors.error ? (
                <AsyncError
                  error={shareVisitors.error}
                  variant={'inline'}
                  onRetry={shareVisitors.retry}
                />
              ) : (
                <ShareVisitorSection conversations={visibleShareVisitors} />
              )}
              {totalAfterFilter === 0 ? null : viewMode === 'card' ? (
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
              {!isSearchMode && hasMore && (
                <div aria-hidden ref={sentinelRef} style={{ height: 1 }} />
              )}
              {!isSearchMode && isLoadingMore && (
                <Flexbox align={'center'} paddingBlock={12}>
                  <span className={shinyTextStyles.shinyText} style={{ fontSize: 12 }}>
                    {t('management.loadingMore')}
                  </span>
                </Flexbox>
              )}
              {!isSearchMode && loadMoreError && !isLoadingMore && (
                <Flexbox align={'center'} paddingBlock={12}>
                  <AsyncError
                    error={loadMoreError}
                    variant={'inline'}
                    onRetry={() => {
                      void loadMoreAgentTopicsView();
                    }}
                  />
                </Flexbox>
              )}
            </>
          )}
        </Flexbox>
      </div>
    </Flexbox>
  );
});

AgentTopicManager.displayName = 'AgentTopicManager';

export default AgentTopicManager;
