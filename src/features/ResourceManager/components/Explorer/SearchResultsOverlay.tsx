'use client';

import { Center, Checkbox, Flexbox } from '@lobehub/ui';
import { VirtuosoMasonry } from '@virtuoso.dev/masonry';
import { cssVar } from 'antd-style';
import { SearchIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useClientDataSWR } from '@/libs/swr';
import { resourceService } from '@/services/resource';
import { useGlobalStore } from '@/store/global';
import { INITIAL_STATUS } from '@/store/global/initialState';
import type { AsyncTaskStatus } from '@/types/asyncTask';
import type { FileListItem } from '@/types/files';

import FileListItemComponent from './ListView/ListItem';
import MasonryItemWrapper from './MasonryView/MasonryItem/MasonryItemWrapper';
import { useMasonryColumnCount } from './useMasonryColumnCount';

const SWR_RESOURCE_SEARCH = 'SWR_RESOURCE_SEARCH';

const SearchResultsOverlay = memo(() => {
  const { t } = useTranslation('components');
  const [searchQuery, libraryId, category, viewMode] = useResourceManagerStore((s) => [
    s.searchQuery,
    s.libraryId,
    s.category,
    s.viewMode,
  ]);

  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);

  const columnWidths = useGlobalStore(
    (s) => s.status.resourceManagerColumnWidths || INITIAL_STATUS.resourceManagerColumnWidths,
  );
  const columnCount = useMasonryColumnCount();

  const isActive = !!searchQuery && searchQuery.length > 0;

  const { data: rawData, isLoading } = useClientDataSWR(
    isActive
      ? [
          SWR_RESOURCE_SEARCH,
          { category: libraryId ? undefined : category, libraryId, q: searchQuery },
        ]
      : null,
    async ([, params]: [string, { category?: string; libraryId?: string; q: string }]) => {
      const response = await resourceService.queryResources({
        ...params,
        limit: 50,
        offset: 0,
        showFilesInKnowledgeBase: false,
      } as any);
      return response.items;
    },
  );

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
      knowledgeBaseId: libraryId ?? undefined,
      selectFileIds: selectedFileIds,
      setSelectedFileIds,
    }),
    [libraryId, selectedFileIds],
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
          <NeuralNetworkLoading size={48} />
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
              align="center"
              horizontal
              paddingInline={8}
              style={{
                borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}`,
                color: cssVar.colorTextDescription as string,
                fontSize: 12,
                height: 40,
                minHeight: 40,
                minWidth: 800,
              }}
            >
              <Center height={40} style={{ paddingInline: 4 }}>
                <Checkbox checked={false} disabled />
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
                itemContent={(index, item) => {
                  if (!item) return null;
                  return (
                    <FileListItemComponent
                      columnWidths={columnWidths}
                      index={index}
                      isAnyRowHovered={false}
                      key={item.id}
                      selected={selectedFileIds.includes(item.id)}
                      onHoverChange={() => {}}
                      onSelectedChange={(id, checked) => {
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
                style={{ height: '100%' }}
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
