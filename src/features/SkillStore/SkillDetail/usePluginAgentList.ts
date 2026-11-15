import { useCallback, useMemo, useState } from 'react';

import { useDiscoverStore } from '@/store/discover';
import { marketSelectors } from '@/store/discover/selectors';
import { pluginAgentsParams } from '@/store/discover/slices/market/action';
import { pluginAgentsQueryKey } from '@/store/discover/slices/market/projection';
import { globalHelpers } from '@/store/global/helpers';
import { type DiscoverAssistantItem } from '@/types/discover';

const pageKey = (pluginId: string, page: number) =>
  pluginAgentsQueryKey(pluginAgentsParams(pluginId, page));

/**
 * The agents that use a plugin or skill, walked page by page. Every page is a
 * replica entry, so reopening a detail paints the last confirmed first page
 * before the network answers; later pages load as the grid scrolls.
 */
export const usePluginAgentList = (pluginId: string | undefined) => {
  // Pages walked so far, owned by the plugin and UI language they were walked
  // for: either changing starts again from the first page in the same render
  // (each language is its own set of entries, so a later page alone would
  // never paint).
  const locale = globalHelpers.getCurrentLanguage();
  const [walked, setWalked] = useState({ locale, pageCount: 1, pluginId });
  const pageCount = walked.pluginId === pluginId && walked.locale === locale ? walked.pageCount : 1;

  const usePluginAgents = useDiscoverStore((s) => s.usePluginAgents);
  const { error, revalidate } = usePluginAgents(pluginId, pageCount);

  // Rows of every loaded page in order, up to the first page without a value,
  // so a gap never renders out of order.
  const pluginAgentsMap = useDiscoverStore((s) => s.pluginAgentsMap);
  const { items, loadedPages, totalCount } = useMemo(() => {
    const rows: DiscoverAssistantItem[] = [];
    let loaded = 0;
    let total: number | undefined;
    if (!pluginId) return { items: rows, loadedPages: loaded, totalCount: total };
    for (let page = 1; page <= pageCount; page++) {
      const entry = pluginAgentsMap[pageKey(pluginId, page)];
      if (!entry) break;
      rows.push(...entry.items);
      loaded = page;
      total = entry.totalCount;
    }
    return { items: rows, loadedPages: loaded, totalCount: total };
  }, [pluginAgentsMap, pluginId, pageCount]);

  const isConfirmed = useDiscoverStore(
    marketSelectors.isPluginAgentsConfirmed(pluginId ? pageKey(pluginId, 1) : undefined),
  );

  const hasMore = totalCount !== undefined && items.length < totalCount;
  const isPageLoading = loadedPages < pageCount && !error;

  const loadMore = useCallback(() => {
    // A failing page is retried explicitly, not by the scroll observer.
    if (isPageLoading || error || !hasMore) return;
    setWalked({ locale, pageCount: pageCount + 1, pluginId });
  }, [error, hasMore, isPageLoading, locale, pageCount, pluginId]);

  const retry = useCallback(() => {
    void revalidate();
  }, [revalidate]);

  return {
    /** Only a failure with nothing to show takes over the grid. */
    error: items.length === 0 ? error : undefined,
    isEmpty: items.length === 0 && isConfirmed && loadedPages > 0,
    /**
     * Nothing to paint yet. A hydrated empty first page is not proof of "no
     * agents" until the server confirms it, so it stays in loading too.
     */
    isInitialLoading: items.length === 0 && !error && (!isConfirmed || loadedPages === 0),
    isLoadingMore: items.length > 0 && isPageLoading,
    items,
    loadMore,
    /** A page failed while rows are on screen: keep them and offer an inline retry. */
    pageError: items.length > 0 ? error : undefined,
    retry,
  };
};
