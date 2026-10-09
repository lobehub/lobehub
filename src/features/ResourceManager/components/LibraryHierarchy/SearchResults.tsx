'use client';

import { Center, Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { useDebounce } from 'ahooks';
import { cssVar } from 'antd-style';
import { isEqual } from 'es-toolkit';
import { SearchXIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { VList, type VListHandle } from 'virtua';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useFolderPath } from '@/features/ResourceManager/hooks/useFolderPath';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import {
  DEFAULT_SEARCH_PAGE_SIZE,
  type HierarchySearchParams,
} from '@/features/ResourceManager/store/projection';
import { toTreeItem } from '@/store/tree';

import { HierarchyNode } from './HierarchyNode';
import { resolveHierarchySelectedKey } from './selection';
import TreeSkeleton from './TreeSkeleton';

const noop = () => {};

interface SearchResultsProps {
  libraryId: string;
  query: string;
}

/**
 * Flat, library-scoped search results that replace the folder tree in the
 * sidebar while the user has a query typed. Rows reuse `HierarchyNode` so a
 * hit opens exactly like its tree counterpart (folder → navigate, page → page
 * editor, file → file editor) and keeps the same context menu.
 *
 * The rows are a `@lobechat/replica` entry owned by the ResourceManager store:
 * the head page is persisted, so coming back to the same search paints it
 * before the request lands, and "load more" appends further pages through the
 * engine instead of re-fetching a widening window.
 */
const SearchResults = memo<SearchResultsProps>(({ libraryId, query }) => {
  const { t } = useTranslation('file');
  const { currentFolderSlug } = useFolderPath();
  const currentViewItemId = useResourceManagerStore((s) => s.currentViewItemId);
  const selectedKey = resolveHierarchySelectedKey({ currentFolderSlug, currentViewItemId });
  // Debounce here rather than in the input so the store always holds what the
  // user sees; only the network request lags behind the keystrokes.
  const debouncedQuery = useDebounce(query.trim(), { wait: 300 });

  // The keyword is part of the query identity, so a projection taken under
  // another search never paints and a new query starts its own head page.
  const searchParams = useMemo<HierarchySearchParams | null>(
    () =>
      debouncedQuery ? { libraryId, pageSize: DEFAULT_SEARCH_PAGE_SIZE, q: debouncedQuery } : null,
    [debouncedQuery, libraryId],
  );

  const { error, revalidate } = useResourceManagerStore((s) => s.useFetchHierarchySearch)(
    searchParams,
  );
  const loadMore = useResourceManagerStore((s) => s.loadMoreHierarchySearch);
  const entry = useResourceManagerStore((s) => s.hierarchySearchEntry);

  // `entry` may still hold the previous window while a new one is in flight, so
  // only rows that echo the current query count as current.
  const current = useMemo(
    () =>
      searchParams && entry?.searchParams && isEqual(entry.searchParams, searchParams)
        ? entry
        : undefined,
    [entry, searchParams],
  );

  const rows = useMemo(
    () =>
      current?.items.map((row) => ({ item: toTreeItem(row), parentKey: row.parentId ?? '' })) ?? [],
    [current],
  );
  const hasMore = current?.hasMore ?? false;
  const isLoadingMore = current?.isLoadingMore ?? false;

  const listRef = useRef<VListHandle>(null);
  const handleScroll = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    const list = listRef.current;
    if (!list) return;
    // Within roughly one viewport of the bottom: fetch the next page early
    // enough that the user rarely hits the end of the list.
    const remaining = list.scrollSize - (list.scrollOffset + list.viewportSize);
    if (remaining <= list.viewportSize) void loadMore();
  }, [hasMore, isLoadingMore, loadMore]);

  // Bridge the debounce gap: the query is already non-empty but the fetch for
  // it has not been issued yet, so treat it as loading instead of "no results".
  const isWaitingForDebounce = !debouncedQuery || debouncedQuery !== query.trim();

  const emptyState = (
    <Center gap={12} padding={24} style={{ height: '100%', textAlign: 'center' }}>
      <Icon color={cssVar.colorTextQuaternary} icon={SearchXIcon} size={32} />
      <Text style={{ fontSize: 12 }} type={'secondary'}>
        {t('library.hierarchy.search.noResults')}
      </Text>
    </Center>
  );

  return (
    <AsyncBoundary
      data={current}
      empty={emptyState}
      error={error}
      errorVariant={'block'}
      isEmpty={rows.length === 0}
      // No current-query data yet (initial load or a query change) counts as
      // loading unless the request already failed, so the error state can show.
      isLoading={(!current && !error) || isWaitingForDebounce}
      loading={<TreeSkeleton />}
      onRetry={() => revalidate()}
    >
      <Flexbox paddingInline={4} style={{ height: '100%' }}>
        <VList
          bufferSize={typeof window !== 'undefined' ? window.innerHeight : 0}
          ref={listRef}
          style={{ height: '100%' }}
          onScroll={handleScroll}
        >
          {rows.map(({ item, parentKey }) => (
            <div key={item.id} style={{ paddingBottom: 2 }}>
              <HierarchyNode
                flat
                isExpanded={false}
                isLoading={false}
                item={item}
                parentKey={parentKey}
                selectedKey={selectedKey}
                onToggle={noop}
              />
            </div>
          ))}
          {isLoadingMore && (
            <div key={'__loading_more__'} style={{ paddingBottom: 2 }}>
              <TreeSkeleton count={3} />
            </div>
          )}
        </VList>
      </Flexbox>
    </AsyncBoundary>
  );
});

SearchResults.displayName = 'LibraryHierarchySearchResults';

export default SearchResults;
