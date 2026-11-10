'use client';

import { Center, cssVar, Flexbox, Spin } from '@lobehub/ui';
import { VirtuosoMasonry } from '@virtuoso.dev/masonry';
import { SearchIcon } from 'lucide-react';
import { memo, type UIEvent, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VirtuosoHandle } from 'react-virtuoso';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncError from '@/components/AsyncError';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { useGlobalStore } from '@/store/global';
import {
  DEFAULT_RESOURCE_MANAGER_COLUMN_WIDTHS,
  INITIAL_STATUS,
} from '@/store/global/initialState';

import { useExplorerSearchResults } from './hooks/useExplorerSearchResults';
import { useExplorerSelectionActions } from './hooks/useExplorerSelection';
import ListViewHeader from './ListView/ListViewHeader';
import VirtualizedFileList from './ListView/VirtualizedFileList';
import MasonryItemWrapper from './MasonryView/MasonryItem/MasonryItemWrapper';
import SelectionToolbar from './MasonryView/SelectionToolbar';
import { useContainerMasonryColumnCount } from './useMasonryColumnCount';

const SearchResultsOverlay = memo(() => {
  const { t } = useTranslation('components');
  const [libraryId, viewMode, listVisibility] = useResourceManagerStore((s) => [
    s.libraryId,
    s.viewMode,
    s.listVisibility,
  ]);
  const {
    data,
    error,
    hasMore,
    isLoading,
    isLoadingMore,
    loadMore,
    loadMoreError,
    revalidate,
    searchParams,
    total,
  } = useExplorerSearchResults();
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  const columnWidths = useGlobalStore((s) => ({
    ...DEFAULT_RESOURCE_MANAGER_COLUMN_WIDTHS,
    ...(s.status.resourceManagerColumnWidths || INITIAL_STATUS.resourceManagerColumnWidths),
  }));
  const [masonryContainer, setMasonryContainer] = useState<HTMLDivElement | null>(null);
  const columnCount = useContainerMasonryColumnCount(masonryContainer);

  // Personal account has only one uploader (the user themselves), so hide the
  // column entirely there — it only makes sense in a workspace with multiple members.
  const activeWorkspaceId = useActiveWorkspaceId();
  const showUploader = !!activeWorkspaceId && (!!libraryId || listVisibility !== 'private');

  // Selection lives in the ResourceManager store, like the folder list's, so the
  // header's batch actions (delete, chunking, add to library) act on the hits
  // checked here.
  const { isItemSelectable, selectAllState, selectedFileIds, toggleItemSelection } =
    useExplorerSelectionActions(data);

  const masonryContext = useMemo(
    () => ({
      isItemSelectable,
      knowledgeBaseId: libraryId ?? undefined,
      onSelectedChange: toggleItemSelection,
      selectAllState,
      selectFileIds: selectedFileIds,
    }),
    [isItemSelectable, libraryId, selectAllState, selectedFileIds, toggleItemSelection],
  );

  const handleMasonryScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const { clientHeight, scrollHeight, scrollTop } = e.currentTarget;
      // While a page failed, stop auto-fetching: the tail shows a retry and
      // scrolling must not re-issue the failing request on every frame.
      if (
        hasMore &&
        !isLoadingMore &&
        !loadMoreError &&
        scrollHeight - scrollTop - clientHeight < 300
      )
        void loadMore();
    },
    [hasMore, isLoadingMore, loadMore, loadMoreError],
  );

  if (!searchParams) return null;

  return (
    <div
      style={{
        background: cssVar.colorBgContainer as string,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        left: 0,
        position: 'absolute',
        right: 0,
        top: 0,
        zIndex: 10,
      }}
    >
      {isLoading ? (
        <Center height="100%">
          <Spin size="large" />
        </Center>
      ) : error && data.length === 0 ? (
        // A failed search fetch used to fall through to the "no results" state, telling
        // the user their query matched nothing when the request actually errored
        // (Read §1.1). Branch the failure before the no-match state; the no-match
        // variant below is untouched and still handles a genuine zero-result search.
        <Center height="100%">
          <AsyncError error={error} variant={'block'} onRetry={() => revalidate()} />
        </Center>
      ) : data.length === 0 ? (
        <Center height="100%">
          <Flexbox align="center" gap={8}>
            <SearchIcon size={32} style={{ color: cssVar.colorTextQuaternary as string }} />
            <span style={{ color: cssVar.colorTextDescription as string, fontSize: 14 }}>
              {t('FileManager.search.noResults')}
            </span>
          </Flexbox>
        </Center>
      ) : viewMode === 'list' ? (
        // Size the list to the overlay's remaining height (below the header and
        // select-all hint): a library hero sits above the overlay, so a
        // viewport-derived height would push the last rows below the clip.
        <Flexbox height={'100%'} style={{ overflow: 'auto hidden' }}>
          <ListViewHeader
            columnWidths={columnWidths}
            data={data}
            hasMore={hasMore}
            showUploader={showUploader}
            total={total}
          />
          <div style={{ flex: 1, minHeight: 0 }}>
            <VirtualizedFileList
              columnWidths={columnWidths}
              data={data}
              hasMore={hasMore}
              height={'100%'}
              loadMore={loadMore}
              loadMoreError={loadMoreError}
              showUploader={showUploader}
              virtuosoRef={virtuosoRef}
            />
          </div>
        </Flexbox>
      ) : (
        <div style={{ flex: 1, height: '100%', overflowY: 'auto' }} onScroll={handleMasonryScroll}>
          <div
            ref={setMasonryContainer}
            style={{ paddingBlockEnd: 24, paddingBlockStart: 12, paddingInline: 24 }}
          >
            <SelectionToolbar
              data={data}
              hasMore={hasMore}
              itemCount={total ?? data.length}
              total={total}
            />
            <VirtuosoMasonry
              ItemContent={MasonryItemWrapper}
              columnCount={columnCount}
              context={masonryContext}
              data={data}
              style={{
                gap: '16px',
                overflow: 'hidden',
              }}
            />
            {loadMoreError ? (
              <div style={{ paddingBlockStart: 8 }}>
                <AsyncError
                  error={loadMoreError}
                  retrying={isLoadingMore}
                  variant={'inline'}
                  onRetry={() => void loadMore()}
                />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
});

SearchResultsOverlay.displayName = 'SearchResultsOverlay';

export default SearchResultsOverlay;
