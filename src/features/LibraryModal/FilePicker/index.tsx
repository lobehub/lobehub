'use client';

import {
  Alert,
  Button,
  Center,
  createModal,
  createStaticStyles,
  Empty,
  Flexbox,
  Icon,
  useModalContext,
} from '@lobehub/ui';
import { t } from 'i18next';
import { FileSearch, ServerCrash } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';

import type { ExistingEditorAttachment } from '@/features/EditorCanvas/editorAttachments';
import { useGlobalStore } from '@/store/global';
import { KnowledgeType } from '@/types/knowledgeBase';

import Item from '../AssignKnowledgeBase/Item';
import MasonryItem from '../AssignKnowledgeBase/Item/MasonryItem';
import Loading from '../AssignKnowledgeBase/Loading';
import ViewSwitcher from '../AssignKnowledgeBase/ViewSwitcher';
import { type ViewMode } from '../AssignKnowledgeBase/ViewSwitcher';
import { type AttachableFile, useLibraryFiles } from './useLibraryFiles';

const styles = createStaticStyles(({ css }) => ({
  grid: css`
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;

    padding-block: 4px;
  `,
}));

interface FilePickerProps {
  onSelect: (attachments: ExistingEditorAttachment[]) => void;
}

const FilePicker = memo<FilePickerProps>(({ onSelect }) => {
  const { t } = useTranslation(['file', 'chat', 'common']);
  const { close } = useModalContext();
  const viewMode = useGlobalStore((s) => s.status.knowledgeBaseModalViewMode || 'list') as ViewMode;
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const {
    error,
    files,
    hasMore,
    isAttachable,
    isLoading,
    isLoadingMore,
    loadMore,
    refreshError,
    retry,
  } = useLibraryFiles();

  const handleSelect = useCallback(
    (file: AttachableFile) => {
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
    (file: AttachableFile) => (
      <Button disabled={!isAttachable} onClick={() => handleSelect(file)}>
        {t('knowledgeBase.library.action.add', { ns: 'chat' })}
      </Button>
    ),
    [handleSelect, isAttachable, t],
  );

  const renderItem = useCallback(
    (file: AttachableFile) => (
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

  return (
    <Flexbox height={500} width={'100%'}>
      <Flexbox horizontal align={'center'} justify={'flex-end'} style={{ paddingBlockEnd: 12 }}>
        <ViewSwitcher
          view={viewMode}
          onViewChange={(mode) => updateSystemStatus({ knowledgeBaseModalViewMode: mode })}
        />
      </Flexbox>
      {!!refreshError && (
        <Alert
          description={t('networkError', { ns: 'file' })}
          style={{ marginBlockEnd: 12 }}
          type={'warning'}
          action={
            <Button size={'small'} onClick={() => void retry()}>
              {t('retry', { ns: 'common' })}
            </Button>
          }
        />
      )}
      {isLoading ? (
        <Loading />
      ) : error ? (
        <Center flex={1} gap={12} padding={40}>
          <Icon icon={ServerCrash} size={80} />
          {t('networkError', { ns: 'file' })}
          <Button onClick={() => void retry()}>{t('retry', { ns: 'common' })}</Button>
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
            <Button loading={isLoadingMore} type={'text'} onClick={loadMore}>
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
