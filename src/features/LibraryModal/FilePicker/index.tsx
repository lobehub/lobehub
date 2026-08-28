'use client';

import { Center, Empty, Flexbox, Icon } from '@lobehub/ui';
import { Button, createModal, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { t } from 'i18next';
import { FileSearch, ServerCrash } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';
import useSWRInfinite from 'swr/infinite';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import type { ExistingEditorAttachment } from '@/features/EditorCanvas/editorAttachments';
import { resourceService } from '@/services/resource';
import { useGlobalStore } from '@/store/global';
import { KnowledgeType } from '@/types/knowledgeBase';
import type { ResourceItem } from '@/types/resource';

import Item from '../AssignKnowledgeBase/Item';
import MasonryItem from '../AssignKnowledgeBase/Item/MasonryItem';
import Loading from '../AssignKnowledgeBase/Loading';
import { type ViewMode } from '../AssignKnowledgeBase/ViewSwitcher';
import ViewSwitcher from '../AssignKnowledgeBase/ViewSwitcher';

const PAGE_SIZE = 50;

const styles = createStaticStyles(({ css }) => ({
  grid: css`
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;

    padding-block: 4px;
  `,
}));

interface ResourcePage {
  hasMore: boolean;
  items: ResourceItem[];
}

interface FilePickerProps {
  onSelect: (attachments: ExistingEditorAttachment[]) => void;
}

const isAttachableFile = (
  item: ResourceItem,
): item is ResourceItem & { sourceType: 'file'; url: string } =>
  item.sourceType === 'file' && Boolean(item.url);

const FilePicker = memo<FilePickerProps>(({ onSelect }) => {
  const { t } = useTranslation(['file', 'chat', 'common']);
  const { close } = useModalContext();
  const workspaceId = useActiveWorkspaceId();
  const viewMode = useGlobalStore((s) => s.status.knowledgeBaseModalViewMode || 'list') as ViewMode;
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const getKey = useCallback(
    (pageIndex: number, previousPage: ResourcePage | null) => {
      if (previousPage && !previousPage.hasMore) return null;
      return ['comment-library-files', workspaceId, pageIndex * PAGE_SIZE] as const;
    },
    [workspaceId],
  );

  const { data, error, isLoading, isValidating, mutate, setSize } = useSWRInfinite<ResourcePage>(
    getKey,
    ([, , offset]: readonly [string, string | null, number]) =>
      resourceService.queryResources({
        limit: PAGE_SIZE,
        offset,
        showFilesInKnowledgeBase: true,
      }),
    { revalidateFirstPage: false },
  );

  const files = useMemo(() => {
    const uniqueFiles = new Map<string, ResourceItem & { sourceType: 'file'; url: string }>();
    for (const item of data?.flatMap((page) => page?.items ?? []) ?? []) {
      if (!isAttachableFile(item)) continue;
      uniqueFiles.set(item.fileId || item.id, item);
    }
    return [...uniqueFiles.values()];
  }, [data]);
  const lastPage = data?.findLast(Boolean);
  const hasMore = Boolean(lastPage?.hasMore);

  useEffect(() => {
    if (!isLoading && !isValidating && files.length === 0 && hasMore) {
      void setSize((current) => current + 1);
    }
  }, [files.length, hasMore, isLoading, isValidating, setSize]);

  const handleSelect = useCallback(
    (file: ResourceItem & { sourceType: 'file'; url: string }) => {
      onSelect([
        {
          fileId: file.fileId || file.id,
          fileType: file.fileType,
          name: file.name,
          size: file.size,
          url: file.url,
        },
      ]);
      close();
    },
    [close, onSelect],
  );

  const renderAction = useCallback(
    (file: ResourceItem & { sourceType: 'file'; url: string }) => (
      <Button type={'primary'} onClick={() => handleSelect(file)}>
        {t('knowledgeBase.library.action.add', { ns: 'chat' })}
      </Button>
    ),
    [handleSelect, t],
  );

  const renderItem = useCallback(
    (file: ResourceItem & { sourceType: 'file'; url: string }) => (
      <Item
        action={renderAction(file)}
        fileType={file.fileType}
        id={file.fileId || file.id}
        name={file.name}
        type={KnowledgeType.File}
        visibility={file.visibility ?? undefined}
      />
    ),
    [renderAction],
  );

  const loadMore = useCallback(() => {
    if (hasMore && !isValidating) void setSize((current) => current + 1);
  }, [hasMore, isValidating, setSize]);

  return (
    <Flexbox height={500} width={'100%'}>
      <Flexbox horizontal align={'center'} justify={'flex-end'} style={{ paddingBlockEnd: 12 }}>
        <ViewSwitcher
          view={viewMode}
          onViewChange={(mode) => updateSystemStatus({ knowledgeBaseModalViewMode: mode })}
        />
      </Flexbox>
      {isLoading && files.length === 0 ? (
        <Loading />
      ) : error && files.length === 0 ? (
        <Center flex={1} gap={12} padding={40}>
          <Icon icon={ServerCrash} size={80} />
          {t('networkError', { ns: 'file' })}
          <Button onClick={() => void mutate()}>{t('retry', { ns: 'common' })}</Button>
        </Center>
      ) : files.length === 0 ? (
        <Center flex={1} padding={40}>
          <Empty
            description={t('empty', { ns: 'file' })}
            descriptionProps={{ fontSize: 14 }}
            icon={FileSearch}
          />
        </Center>
      ) : viewMode === 'list' ? (
        <Virtuoso
          data={files}
          endReached={loadMore}
          increaseViewportBy={typeof window !== 'undefined' ? window.innerHeight : 0}
          itemContent={(_, file) => renderItem(file)}
          overscan={24}
          style={{ flex: 1, marginInline: -16 }}
        />
      ) : (
        <div className={styles.grid}>
          {files.map((file) => (
            <MasonryItem
              action={renderAction(file)}
              fileType={file.fileType}
              id={file.fileId || file.id}
              key={file.fileId || file.id}
              name={file.name}
              type={KnowledgeType.File}
              visibility={file.visibility ?? undefined}
            />
          ))}
          {hasMore && (
            <Button loading={isValidating} type={'text'} onClick={loadMore}>
              {t('loadMore', { ns: 'file' })}
            </Button>
          )}
        </div>
      )}
    </Flexbox>
  );
});

FilePicker.displayName = 'LibraryFilePicker';

export const openLibraryFilePicker = (
  onSelect: (attachments: ExistingEditorAttachment[]) => void,
) =>
  createModal({
    content: <FilePicker onSelect={onSelect} />,
    footer: false,
    styles: { content: { overflow: 'hidden' } },
    title: t('knowledgeBase.library.title', { ns: 'chat' }),
    width: 600,
  });
