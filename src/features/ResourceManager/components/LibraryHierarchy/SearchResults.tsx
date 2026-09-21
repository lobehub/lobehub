'use client';

import { Center, Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { useDebounce } from 'ahooks';
import { cssVar } from 'antd-style';
import { SearchXIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VList, type VListHandle } from 'virtua';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncBoundary from '@/components/AsyncBoundary';
import { useFolderPath } from '@/features/ResourceManager/hooks/useFolderPath';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { useClientDataSWR } from '@/libs/swr';
import { resourceKeys } from '@/libs/swr/keys';
import { resourceService } from '@/services/resource';
import { toTreeItem } from '@/store/tree';

import { HierarchyNode } from './HierarchyNode';
import { resolveHierarchySelectedKey } from './selection';
import TreeSkeleton from './TreeSkeleton';

/** Rows fetched per step; the list grows by this much each time the end is reached. */
const SEARCH_PAGE_SIZE = 50;
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
 */
const SearchResults = memo<SearchResultsProps>(({ libraryId, query }) => {
  const { t } = useTranslation('file');
  const { currentFolderSlug } = useFolderPath();
  const currentViewItemId = useResourceManagerStore((s) => s.currentViewItemId);
  const selectedKey = resolveHierarchySelectedKey({ currentFolderSlug, currentViewItemId });
  const activeWorkspaceId = useActiveWorkspaceId();
  // Debounce here rather than in the input so the store always holds what the
  // user sees; only the network request lags behind the keystrokes.
  const debouncedQuery = useDebounce(query.trim(), { wait: 300 });

  // Incremental loading: the requested window grows from the start each time
  // the user scrolls to the end, so the whole result set stays one SWR entry
  // (one key to revalidate after a rename/move/delete) and the tree-store
  // revalidation can find it by the `hierarchy` scope. A new query starts over.
  const [limit, setLimit] = useState(SEARCH_PAGE_SIZE);
  useEffect(() => {
    setLimit(SEARCH_PAGE_SIZE);
  }, [debouncedQuery, libraryId]);

  const { data, error, isValidating, mutate } = useClientDataSWR(
    debouncedQuery
      ? resourceKeys.search(
          { libraryId, limit, q: debouncedQuery, scope: 'hierarchy' },
          activeWorkspaceId ?? null,
        )
      : null,
    async ([, params]: [string, { libraryId: string; limit: number; q: string }]) => {
      const response = await resourceService.queryResources({
        libraryId: params.libraryId,
        limit: params.limit,
        offset: 0,
        q: params.q,
        showFilesInKnowledgeBase: false,
      });
      // Echo the scope so retained data from a previous key can be told apart.
      return {
        hasMore: response.hasMore,
        items: response.items,
        libraryId: params.libraryId,
        q: params.q,
      };
    },
    // Growing the window must not flash the skeleton over rows already shown.
    // The trade-off is that a *new* query also keeps the old rows around, so
    // only data that echoes the current query/library counts as current below.
    { keepPreviousData: true },
  );

  const current = data?.q === debouncedQuery && data.libraryId === libraryId ? data : undefined;
  const rows = useMemo(
    () =>
      current?.items.map((row) => ({ item: toTreeItem(row), parentKey: row.parentId ?? '' })) ?? [],
    [current],
  );
  const hasMore = current?.hasMore ?? false;
  // `current` may still be the previous window while the larger one is in flight.
  const isLoadingMore = isValidating && rows.length > 0 && rows.length < limit;

  const listRef = useRef<VListHandle>(null);
  const handleScroll = useCallback(() => {
    if (!hasMore || isValidating) return;
    const list = listRef.current;
    if (!list) return;
    // Within roughly one viewport of the bottom: fetch the next window early
    // enough that the user rarely hits the end of the list.
    const remaining = list.scrollSize - (list.scrollOffset + list.viewportSize);
    if (remaining <= list.viewportSize) setLimit((current) => current + SEARCH_PAGE_SIZE);
  }, [hasMore, isValidating]);

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
      // No current-key data yet (initial load or a query change) counts as loading
      // unless the request already failed, so the error state can show.
      isLoading={(!current && !error) || isWaitingForDebounce}
      loading={<TreeSkeleton />}
      onRetry={() => mutate()}
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
