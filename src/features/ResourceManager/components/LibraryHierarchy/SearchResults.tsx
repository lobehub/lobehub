'use client';

import { Center, Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { useDebounce } from 'ahooks';
import { cssVar } from 'antd-style';
import { SearchXIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { VList } from 'virtua';

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

const SEARCH_LIMIT = 50;
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

  const { data, error, isLoading, mutate } = useClientDataSWR(
    debouncedQuery
      ? resourceKeys.search(
          { libraryId, q: debouncedQuery, scope: 'hierarchy' },
          activeWorkspaceId ?? null,
        )
      : null,
    async ([, params]: [string, { libraryId: string; q: string }]) => {
      const response = await resourceService.queryResources({
        libraryId: params.libraryId,
        limit: SEARCH_LIMIT,
        offset: 0,
        q: params.q,
        showFilesInKnowledgeBase: false,
      });
      return response.items;
    },
  );

  const rows = useMemo(
    () => data?.map((row) => ({ item: toTreeItem(row), parentKey: row.parentId ?? '' })) ?? [],
    [data],
  );

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
      data={data}
      empty={emptyState}
      error={error}
      errorVariant={'block'}
      isEmpty={rows.length === 0}
      isLoading={isLoading || isWaitingForDebounce}
      loading={<TreeSkeleton />}
      onRetry={() => mutate()}
    >
      <Flexbox paddingInline={4} style={{ height: '100%' }}>
        <VList
          bufferSize={typeof window !== 'undefined' ? window.innerHeight : 0}
          style={{ height: '100%' }}
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
        </VList>
      </Flexbox>
    </AsyncBoundary>
  );
});

SearchResults.displayName = 'LibraryHierarchySearchResults';

export default SearchResults;
