'use client';

import { Center, Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { useDebounce } from 'ahooks';
import { cssVar } from 'antd-style';
import { SearchXIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { VList, type VListHandle } from 'virtua';

import AsyncBoundary from '@/components/AsyncBoundary';
import AsyncError from '@/components/AsyncError';
import { useFolderPath } from '@/features/ResourceManager/hooks/useFolderPath';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import {
  DEFAULT_SEARCH_PAGE_SIZE,
  type HierarchySearchParams,
  hierarchySearchResource,
} from '@/features/ResourceManager/store/projection';
import { toTreeItem } from '@/store/tree';

import { HierarchyNode } from './HierarchyNode';
import { resolveSearchViewState } from './searchViewState';
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
  const hierarchySearchEntries = useResourceManagerStore((s) => s.hierarchySearchEntries);

  // One entry per (library, keyword): the entry key IS the query identity, so
  // the rows read here always answer the request on screen.
  const entryKey = searchParams ? hierarchySearchResource.key(searchParams) : undefined;
  const current = entryKey ? hierarchySearchEntries[entryKey] : undefined;

  const rows = useMemo(
    () =>
      current?.items.map((row) => ({ item: toTreeItem(row), parentKey: row.parentId ?? '' })) ?? [],
    [current],
  );
  const hasMore = current?.hasMore ?? false;
  const isLoadingMore = current?.isLoadingMore ?? false;
  // A page past the head can fail on its own; the head error never covers it.
  const loadMoreError = current?.loadMoreError;

  const retryLoadMore = useCallback(() => {
    if (entryKey) void loadMore(entryKey);
  }, [entryKey, loadMore]);

  const listRef = useRef<VListHandle>(null);
  const handleScroll = useCallback(() => {
    if (!entryKey || !hasMore || isLoadingMore || loadMoreError) return;
    const list = listRef.current;
    if (!list) return;
    // Within roughly one viewport of the bottom: fetch the next page early
    // enough that the user rarely hits the end of the list.
    const remaining = list.scrollSize - (list.scrollOffset + list.viewportSize);
    if (remaining <= list.viewportSize) void loadMore(entryKey);
  }, [entryKey, hasMore, isLoadingMore, loadMore, loadMoreError]);

  // Bridge the debounce gap: the query is already non-empty but the fetch for
  // it has not been issued yet, so treat it as loading instead of "no results".
  const isWaitingForDebounce = !debouncedQuery || debouncedQuery !== query.trim();

  // A persisted head paints before the refresh lands, and a non-empty one is
  // content worth keeping; an empty one is not (see `resolveSearchViewState`).
  const viewState = resolveSearchViewState({ entry: current, error, isWaitingForDebounce });

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
      data={viewState.data}
      empty={emptyState}
      error={error}
      errorVariant={'block'}
      isEmpty={viewState.isEmpty}
      isLoading={viewState.isLoading}
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
          {loadMoreError ? (
            <div key={'__load_more_error__'} style={{ paddingBottom: 2, paddingTop: 4 }}>
              <AsyncError
                error={loadMoreError}
                retrying={isLoadingMore}
                variant={'inline'}
                onRetry={retryLoadMore}
              />
            </div>
          ) : null}
        </VList>
      </Flexbox>
    </AsyncBoundary>
  );
});

SearchResults.displayName = 'LibraryHierarchySearchResults';

export default SearchResults;
