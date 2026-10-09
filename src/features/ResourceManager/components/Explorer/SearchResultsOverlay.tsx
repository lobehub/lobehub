'use client';

import { Center, Flexbox } from '@lobehub/ui';
import { Checkbox, Spin } from '@lobehub/ui/base-ui';
import { VirtuosoMasonry } from '@virtuoso.dev/masonry';
import { cssVar } from 'antd-style';
import { isEqual } from 'es-toolkit';
import { SearchIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncError from '@/components/AsyncError';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import {
  DEFAULT_SEARCH_PAGE_SIZE,
  type ExplorerSearchParams,
} from '@/features/ResourceManager/store/projection';
import {
  getResourceQueryVisibility,
  getResourceSourceFilter,
} from '@/features/ResourceManager/store/selectors';
import { useGlobalStore } from '@/store/global';
import {
  DEFAULT_RESOURCE_MANAGER_COLUMN_WIDTHS,
  INITIAL_STATUS,
} from '@/store/global/initialState';
import type { AsyncTaskStatus } from '@/types/asyncTask';
import { type FileListItem } from '@/types/files';

import { useExplorerSelectionEligibility } from './hooks/useExplorerSelection';
import FileListItemComponent from './ListView/ListItem';
import { getListViewMinWidth } from './ListView/ListItem/constants';
import MasonryItemWrapper from './MasonryView/MasonryItem/MasonryItemWrapper';
import { useMasonryColumnCount } from './useMasonryColumnCount';

const SearchResultsOverlay = memo(() => {
  const { t } = useTranslation('components');
  const [searchQuery, libraryId, category, viewMode, listVisibility, sourceFilter] =
    useResourceManagerStore((s) => [
      s.searchQuery,
      s.libraryId,
      s.category,
      s.viewMode,
      s.listVisibility,
      getResourceSourceFilter(s),
    ]);

  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const { isItemSelectable } = useExplorerSelectionEligibility();

  const columnWidths = useGlobalStore((s) => ({
    ...DEFAULT_RESOURCE_MANAGER_COLUMN_WIDTHS,
    ...(s.status.resourceManagerColumnWidths || INITIAL_STATUS.resourceManagerColumnWidths),
  }));
  const columnCount = useMasonryColumnCount();

  const isActive = !!searchQuery && searchQuery.length > 0;
  // Personal account has only one uploader (the user themselves), so hide the
  // column entirely there — it only makes sense in a workspace with multiple members.
  const activeWorkspaceId = useActiveWorkspaceId();
  const showUploader = !!activeWorkspaceId && (!!libraryId || listVisibility !== 'private');
  const visibility = getResourceQueryVisibility(libraryId, listVisibility);

  // Search results are a `@lobechat/replica` entry owned by the ResourceManager
  // store: the head page is persisted, so re-opening a search paints the rows it
  // had before the request lands. The keyword is part of the query identity, so
  // the painted rows are only used while they still answer the request on screen.
  const searchParams = useMemo<ExplorerSearchParams | null>(
    () =>
      isActive
        ? {
            category: libraryId ? undefined : category,
            includeContentPreview: viewMode === 'masonry',
            libraryId,
            pageSize: DEFAULT_SEARCH_PAGE_SIZE,
            q: searchQuery!,
            sourceFilter,
            visibility,
          }
        : null,
    [isActive, category, libraryId, searchQuery, sourceFilter, viewMode, visibility],
  );

  const { error, revalidate } = useResourceManagerStore((s) => s.useFetchExplorerSearch)(
    searchParams,
  );
  const explorerSearchEntry = useResourceManagerStore((s) => s.explorerSearchEntry);

  const current = useMemo(
    () =>
      searchParams &&
      explorerSearchEntry?.searchParams &&
      isEqual(explorerSearchEntry.searchParams, searchParams)
        ? explorerSearchEntry
        : undefined,
    [explorerSearchEntry, searchParams],
  );

  const rawData = current?.items;
  const isLoading = !current && !error;
  const mutate = revalidate;

  const data: FileListItem[] | undefined = useMemo(
    () =>
      rawData?.map((item) => ({
        ...item,
        chunkCount: item.chunkCount ?? null,
        chunkingError: item.chunkingError ?? null,
        chunkingStatus: (item.chunkingStatus ?? null) as AsyncTaskStatus | null,
        embeddingError: item.embeddingError ?? null,
        embeddingStatus: (item.embeddingStatus ?? null) as AsyncTaskStatus | null,
        finishEmbedding: item.finishEmbedding ?? false,
        url: item.url ?? '',
      })),
    [rawData],
  );

  const masonryContext = useMemo(
    () => ({
      isItemSelectable,
      knowledgeBaseId: libraryId ?? undefined,
      onSelectedChange: (id: string, checked: boolean) => {
        const item = data?.find((entry) => entry.id === id);
        if (!item || !isItemSelectable(item)) return;

        if (checked) {
          setSelectedFileIds((prev) => [...prev, id]);
        } else {
          setSelectedFileIds((prev) => prev.filter((fid) => fid !== id));
        }
      },
      selectAllState: 'loaded' as const,
      selectFileIds: selectedFileIds,
    }),
    [data, isItemSelectable, libraryId, selectedFileIds],
  );

  if (!isActive) return null;

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
      ) : error && (!data || data.length === 0) ? (
        // A failed search fetch used to fall through to the "no results" state, telling
        // the user their query matched nothing when the request actually errored
        // (Read §1.1). Branch the failure before the no-match state; the no-match
        // variant below is untouched and still handles a genuine zero-result search.
        <Center height="100%">
          <AsyncError error={error} variant={'block'} onRetry={() => mutate()} />
        </Center>
      ) : !data || data.length === 0 ? (
        <Center height="100%">
          <Flexbox align="center" gap={8}>
            <SearchIcon size={32} style={{ color: cssVar.colorTextQuaternary as string }} />
            <span style={{ color: cssVar.colorTextDescription as string, fontSize: 14 }}>
              {t('FileManager.search.noResults')}
            </span>
          </Flexbox>
        </Center>
      ) : viewMode === 'list' ? (
        <Flexbox height={'100%'}>
          <div style={{ flex: 1, overflow: 'auto hidden' }}>
            <Flexbox
              horizontal
              align="center"
              paddingInline={8}
              style={{
                borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}`,
                color: cssVar.colorTextDescription as string,
                fontSize: 12,
                height: 40,
                minHeight: 40,
                minWidth: getListViewMinWidth(showUploader),
              }}
            >
              <Center height={40} style={{ paddingInline: 4 }}>
                <Checkbox disabled checked={false} />
              </Center>
              <Flexbox
                justify="center"
                style={{
                  flexShrink: 0,
                  height: '100%',
                  maxWidth: columnWidths.name,
                  minWidth: columnWidths.name,
                  paddingBlock: 6,
                  paddingInline: '20px 16px',
                  width: columnWidths.name,
                }}
              >
                {t('FileManager.title.title')}
              </Flexbox>
              <Flexbox
                justify="center"
                style={{
                  flexShrink: 0,
                  height: '100%',
                  paddingBlock: 6,
                  paddingInlineEnd: 16,
                  width: columnWidths.date,
                }}
              >
                {t('FileManager.title.createdAt')}
              </Flexbox>
              {showUploader && (
                <Flexbox
                  justify="center"
                  style={{
                    flexShrink: 0,
                    height: '100%',
                    paddingBlock: 6,
                    paddingInlineEnd: 16,
                    width: columnWidths.uploader,
                  }}
                >
                  {t('FileManager.title.uploader')}
                </Flexbox>
              )}
              <Flexbox
                justify="center"
                style={{
                  flexShrink: 0,
                  height: '100%',
                  paddingBlock: 6,
                  paddingInlineEnd: 16,
                  width: columnWidths.size,
                }}
              >
                {t('FileManager.title.size')}
              </Flexbox>
            </Flexbox>
            <div style={{ height: 'calc(100% - 40px)', overflow: 'hidden', position: 'relative' }}>
              <Virtuoso
                data={data}
                defaultItemHeight={48}
                style={{ height: '100%' }}
                itemContent={(index, item) => {
                  if (!item) return null;
                  const selectable = isItemSelectable(item);
                  return (
                    <FileListItemComponent
                      columnWidths={columnWidths}
                      index={index}
                      key={item.id}
                      selectable={selectable}
                      selected={selectable && selectedFileIds.includes(item.id)}
                      showUploader={showUploader}
                      onSelectedChange={(id, checked) => {
                        if (!selectable) return;
                        if (checked) {
                          setSelectedFileIds((prev) => [...prev, id]);
                        } else {
                          setSelectedFileIds((prev) => prev.filter((fid) => fid !== id));
                        }
                      }}
                      {...item}
                    />
                  );
                }}
              />
            </div>
          </div>
        </Flexbox>
      ) : (
        <div
          style={{
            flex: 1,
            height: '100%',
            overflowY: 'auto',
          }}
        >
          <div style={{ paddingBlockEnd: 24, paddingBlockStart: 12, paddingInline: 24 }}>
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
          </div>
        </div>
      )}
    </div>
  );
});

SearchResultsOverlay.displayName = 'SearchResultsOverlay';

export default SearchResultsOverlay;
