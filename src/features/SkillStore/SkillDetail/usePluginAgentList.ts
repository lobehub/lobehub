import { useCallback, useMemo, useState } from 'react';

import { useDiscoverStore } from '@/store/discover';
import { marketSelectors } from '@/store/discover/selectors';

/**
 * The agents that use a plugin or skill, walked page by page. Every page is a
 * replica entry, so reopening a detail paints the last confirmed first page
 * before the network answers; later pages load as the grid scrolls.
 */
export const usePluginAgentList = (pluginId: string | undefined) => {
  // Pages walked so far, owned by the plugin they were walked for: a different
  // plugin starts again from its first page in the same render.
  const [walked, setWalked] = useState({ pageCount: 1, pluginId });
  const pageCount = walked.pluginId === pluginId ? walked.pageCount : 1;

  const usePluginAgents = useDiscoverStore((s) => s.usePluginAgents);
  const { error } = usePluginAgents(pluginId, pageCount);

  const pluginAgentsMap = useDiscoverStore((s) => s.pluginAgentsMap);
  const { items, loadedPages, totalCount } = useMemo(
    () => marketSelectors.pluginAgentPages(pluginAgentsMap, pluginId, pageCount),
    [pluginAgentsMap, pluginId, pageCount],
  );
  const isConfirmed = useDiscoverStore(marketSelectors.isPluginAgentsConfirmed(pluginId));

  const hasMore = totalCount !== undefined && items.length < totalCount;
  const isPageLoading = loadedPages < pageCount && !error;

  const loadMore = useCallback(() => {
    if (isPageLoading || error || !hasMore) return;
    setWalked({ pageCount: pageCount + 1, pluginId });
  }, [error, hasMore, isPageLoading, pageCount, pluginId]);

  return {
    /** Only a failure with nothing to show takes over the grid. */
    error: items.length === 0 ? error : undefined,
    /**
     * Nothing to paint yet. A hydrated empty first page is not proof of "no
     * agents" until the server confirms it, so it stays in loading too.
     */
    isInitialLoading: items.length === 0 && !error && (!isConfirmed || loadedPages === 0),
    isLoadingMore: items.length > 0 && isPageLoading,
    isEmpty: items.length === 0 && isConfirmed && loadedPages > 0,
    items,
    loadMore,
  };
};
