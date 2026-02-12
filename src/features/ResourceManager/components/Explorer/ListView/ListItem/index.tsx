import {
  Button,
  Center,
  Checkbox,
  ContextMenuTrigger,
  Flexbox,
  Icon,
  stopPropagation,
} from '@lobehub/ui';
import { App, Input } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { isNull } from 'es-toolkit/compat';
import { FileBoxIcon, FileText, FolderIcon } from 'lucide-react';
import { type DragEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import {
  getTransparentDragImage,
  useDragActive,
  useDragState,
} from '@/app/[variants]/(main)/resource/features/DndContextWrapper';
import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import FileIcon from '@/components/FileIcon';
import { clearTreeFolderCache } from '@/features/ResourceManager/components/LibraryHierarchy';
import { PAGE_FILE_TYPE } from '@/features/ResourceManager/constants';
import { fileManagerSelectors, useFileStore } from '@/store/file';
import { type FileListItem as FileListItemType } from '@/types/files';
import { formatSize } from '@/utils/format';
import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';

import { useFileItemClick } from '../../hooks/useFileItemClick';
import DropdownMenu from '../../ItemDropdown/DropdownMenu';
import { useFileItemDropdown } from '../../ItemDropdown/useFileItemDropdown';
import ChunksBadge from './ChunkTag';
import TruncatedFileName from './TruncatedFileName';

// Initialize dayjs plugin once at module level
dayjs.extend(relativeTime);

export const FILE_DATE_WIDTH = 160;
export const FILE_SIZE_WIDTH = 140;

const styles = createStaticStyles(({ css }) => {
  return {
    container: css`
      cursor: pointer;
      min-width: 800px;

      &:hover {
        background: ${cssVar.colorFillTertiary};
      }
    `,

    dragOver: css`
      outline: 1px dashed ${cssVar.colorPrimaryBorder};
      outline-offset: -2px;

      &,
      &:hover {
        background: ${cssVar.colorPrimaryBg};
      }
    `,

    dragging: css`
      will-change: transform;
      opacity: 0.5;
    `,

    evenRow: css`
      background: ${cssVar.colorFillQuaternary};

      /* Hover effect overrides zebra striping on the hovered row only */
      &:hover {
        background: ${cssVar.colorFillTertiary};
      }

      /* Hide zebra striping when any row is hovered */
      .any-row-hovered & {
        background: transparent;
      }

      /* But keep hover effect on the actual hovered row */
      .any-row-hovered &:hover {
        background: ${cssVar.colorFillTertiary};
      }
    `,

    hover: css`
      opacity: 0;

      &[data-popup-open],
      .file-list-item-group:hover & {
        opacity: 1;
      }
    `,
    item: css`
      padding-block: 0;
      padding-inline: 0 24px;
      color: ${cssVar.colorTextSecondary};
    `,
    name: css`
      overflow: hidden;
      flex: 1;

      min-width: 0;
      margin-inline-start: 12px;

      color: ${cssVar.colorText};
      white-space: nowrap;
    `,
    nameContainer: css`
      overflow: hidden;
      flex: 1;
      min-width: 0;
    `,
    selected: css`
      background: ${cssVar.colorFillTertiary};

      &:hover {
        background: ${cssVar.colorFillSecondary};
      }
    `,
  };
});

interface FileListItemProps extends FileListItemType {
  columnWidths: {
    date: number;
    name: number;
    size: number;
  };
  index: number;
  isAnyRowHovered: boolean;
  onHoverChange: (isHovered: boolean) => void;
  onSelectedChange: (id: string, selected: boolean, shiftKey: boolean, index: number) => void;
  pendingRenameItemId?: string | null;
  selected?: boolean;
  slug?: string | null;
}

const FileListItem = memo<FileListItemProps>(
  ({
    size,
    chunkingError,
    columnWidths,
    embeddingError,
    embeddingStatus,
    finishEmbedding,
    chunkCount,
    url,
    name,
    fileType,
    id,
    createdAt,
    selected,
    chunkingStatus,
    onSelectedChange,
    index,
    metadata,
    sourceType,
    slug,
    pendingRenameItemId,
    onHoverChange,
  }) => {
    const { t } = useTranslation(['components', 'file']);
    const { message } = App.useApp();
    // Consolidate all FileStore subscriptions with shallow equality
    const fileStoreState = useFileStore(
      (s) => ({
        isCreatingFileParseTask: fileManagerSelectors.isCreatingFileParseTask(id)(s),
        parseFiles: s.parseFilesToChunks,
        refreshFileList: s.refreshFileList,
        updateResource: s.updateResource,
      }),
      shallow,
    );

    // Consolidate all ResourceManagerStore subscriptions with shallow equality
    const resourceManagerState = useResourceManagerStore(
      (s) => ({
        libraryId: s.libraryId,
        setPendingRenameItemId: s.setPendingRenameItemId,
      }),
      shallow,
    );

    const [isRenaming, setIsRenaming] = useState(false);
    const [renamingValue, setRenamingValue] = useState(name);
    const inputRef = useRef<any>(null);
    const isConfirmingRef = useRef(false);
    const isDragActive = useDragActive();
    const { setCurrentDrag } = useDragState();
    const [isDragging, setIsDragging] = useState(false);
    const [isOver, setIsOver] = useState(false);

    const computedValues = useMemo(() => {
      const lowerFileType = fileType?.toLowerCase();
      const lowerName = name?.toLowerCase();
      const isPDF = lowerFileType === 'pdf' || lowerName?.endsWith('.pdf');
      // Office files should use the MSDoc viewer, not the page editor
      const isOfficeFile =
        lowerName?.endsWith('.xls') ||
        lowerName?.endsWith('.xlsx') ||
        lowerName?.endsWith('.doc') ||
        lowerName?.endsWith('.docx') ||
        lowerName?.endsWith('.ppt') ||
        lowerName?.endsWith('.pptx') ||
        lowerName?.endsWith('.odt');
      return {
        emoji: sourceType === 'document' || fileType === PAGE_FILE_TYPE ? metadata?.emoji : null,
        isFolder: fileType === 'custom/folder',
        // PDF and Office files should not be treated as pages, even if they have sourceType='document'
        isPage:
          !isPDF && !isOfficeFile && (sourceType === 'document' || fileType === PAGE_FILE_TYPE),
        isSupportedForChunking: !isChunkingUnsupported(fileType),
      };
    }, [fileType, sourceType, metadata?.emoji, name]);

    const { isSupportedForChunking, isPage, isFolder, emoji } = computedValues;

    const dragData = useMemo(
      () => ({
        fileType,
        isFolder,
        name,
        sourceType,
      }),
      [fileType, isFolder, name, sourceType],
    );

    const handleDragStart = useCallback(
      (e: DragEvent) => {
        if (!resourceManagerState.libraryId) {
          e.preventDefault();
          return;
        }

        setIsDragging(true);
        setCurrentDrag({
          data: dragData,
          id,
          type: isFolder ? 'folder' : 'file',
        });

        // Set drag image to be transparent (we use custom overlay)
        const img = getTransparentDragImage();
        if (img) {
          e.dataTransfer.setDragImage(img, 0, 0);
        }
        e.dataTransfer.effectAllowed = 'move';
      },
      [resourceManagerState.libraryId, dragData, id, isFolder, setCurrentDrag],
    );

    const handleDragEnd = useCallback(() => {
      setIsDragging(false);
    }, []);

    const handleDragOver = useCallback(
      (e: DragEvent) => {
        if (!isFolder || !isDragActive) return;

        e.preventDefault();
        e.stopPropagation();
        setIsOver(true);
      },
      [isFolder, isDragActive],
    );

    const handleDragLeave = useCallback(() => {
      setIsOver(false);
    }, []);

    const handleDrop = useCallback(() => {
      setIsOver(false);
    }, []);

    // Memoize display time calculation
    const displayTime = useMemo(
      () =>
        dayjs().diff(dayjs(createdAt), 'd') < 7
          ? dayjs(createdAt).fromNow()
          : dayjs(createdAt).format('YYYY-MM-DD'),
      [createdAt],
    );

    const handleRenameStart = useCallback(() => {
      setIsRenaming(true);
      setRenamingValue(name);
      // Focus input after render
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }, [name]);

    const handleRenameConfirm = useCallback(async () => {
      // Prevent duplicate calls (e.g., from both Enter key and onBlur)
      if (isConfirmingRef.current) return;
      isConfirmingRef.current = true;

      if (!renamingValue.trim()) {
        message.error(t('FileManager.actions.renameError'));
        isConfirmingRef.current = false;
        return;
      }

      if (renamingValue.trim() === name) {
        setIsRenaming(false);
        isConfirmingRef.current = false;
        return;
      }

      try {
        // Use optimistic updateResource for instant UI update
        await fileStoreState.updateResource(id, { name: renamingValue.trim() });
        if (resourceManagerState.libraryId) {
          await clearTreeFolderCache(resourceManagerState.libraryId);
        }
        await fileStoreState.refreshFileList();

        message.success(t('FileManager.actions.renameSuccess'));
        setIsRenaming(false);
      } catch (error) {
        console.error('Rename error:', error);
        message.error(t('FileManager.actions.renameError'));
      } finally {
        isConfirmingRef.current = false;
      }
    }, [
      fileStoreState.refreshFileList,
      fileStoreState.updateResource,
      id,
      message,
      name,
      renamingValue,
      resourceManagerState.libraryId,
      t,
    ]);

    const handleRenameCancel = useCallback(() => {
      // Don't cancel if we're in the middle of confirming
      if (isConfirmingRef.current) return;
      setIsRenaming(false);
      setRenamingValue(name);
    }, [name]);

    // Use shared click handler hook
    const handleItemClick = useFileItemClick({
      id,
      isFolder,
      isPage,
      libraryId: resourceManagerState.libraryId,
      slug,
    });

    // Auto-start renaming if this is the pending rename item
    useEffect(() => {
      if (pendingRenameItemId === id && isFolder && !isRenaming) {
        handleRenameStart();
        resourceManagerState.setPendingRenameItemId(null);
      }
    }, [pendingRenameItemId, id, isFolder, resourceManagerState]);

    const { menuItems } = useFileItemDropdown({
      fileType,
      filename: name,
      id,
      libraryId: resourceManagerState.libraryId,
      onRenameStart: isFolder ? handleRenameStart : undefined,
      sourceType,
      url,
    });

    return (
      <ContextMenuTrigger items={menuItems}>
        <Flexbox
          horizontal
          align={'center'}
          data-drop-target-id={id}
          data-is-folder={String(isFolder)}
          data-row-index={index}
          draggable={!!resourceManagerState.libraryId}
          height={48}
          paddingInline={8}
          className={cx(
            styles.container,
            'file-list-item-group',
            index % 2 === 0 && styles.evenRow,
            selected && styles.selected,
            isDragging && styles.dragging,
            isOver && styles.dragOver,
          )}
          style={{
            borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}`,
            userSelect: 'none',
          }}
          onDragEnd={handleDragEnd}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDragStart={handleDragStart}
          onDrop={handleDrop}
          onMouseEnter={() => onHoverChange(true)}
          onMouseLeave={() => onHoverChange(false)}
        >
          <Center
            height={40}
            style={{ paddingInline: 4 }}
            onClick={(e) => {
              e.stopPropagation();

              onSelectedChange(id, !selected, e.shiftKey, index);
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              // Prevent text selection when shift-clicking for batch selection
              if (e.shiftKey) {
                e.preventDefault();
              }
            }}
          >
            <Checkbox checked={selected} />
          </Center>
          <Flexbox
            horizontal
            align={'center'}
            className={styles.item}
            distribution={'space-between'}
            style={{
              flexShrink: 0,
              maxWidth: columnWidths.name,
              minWidth: columnWidths.name,
              paddingInline: 8,
              width: columnWidths.name,
            }}
            onClick={handleItemClick}
          >
            <Flexbox horizontal align={'center'} className={styles.nameContainer}>
              <Flexbox
                align={'center'}
                justify={'center'}
                style={{ fontSize: 24, marginInline: 8, width: 24 }}
              >
                {isFolder ? (
                  <Icon icon={FolderIcon} size={24} />
                ) : isPage ? (
                  emoji ? (
                    <span style={{ fontSize: 24 }}>{emoji}</span>
                  ) : (
                    <Center height={24} width={24}>
                      <Icon icon={FileText} size={24} />
                    </Center>
                  )
                ) : (
                  <FileIcon fileName={name} fileType={fileType} size={24} />
                )}
              </Flexbox>
              {isRenaming && isFolder ? (
                <Input
                  ref={inputRef}
                  size="small"
                  style={{ flex: 1, maxWidth: 400 }}
                  value={renamingValue}
                  onBlur={handleRenameConfirm}
                  onChange={(e) => setRenamingValue(e.target.value)}
                  onClick={stopPropagation}
                  onPointerDown={stopPropagation}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleRenameConfirm();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      handleRenameCancel();
                    }
                  }}
                />
              ) : (
                <TruncatedFileName
                  className={styles.name}
                  name={name || t('file:pageList.untitled')}
                />
              )}
            </Flexbox>
            <Flexbox
              horizontal
              align={'center'}
              gap={8}
              paddingInline={8}
              onPointerDown={stopPropagation}
              onClick={stopPropagation}
            >
              {!isFolder &&
                !isPage &&
                (fileStoreState.isCreatingFileParseTask ||
                isNull(chunkingStatus) ||
                !chunkingStatus ? (
                  <div
                    className={fileStoreState.isCreatingFileParseTask ? undefined : styles.hover}
                    title={t(
                      isSupportedForChunking
                        ? 'FileManager.actions.chunkingTooltip'
                        : 'FileManager.actions.chunkingUnsupported',
                    )}
                  >
                    <Button
                      disabled={!isSupportedForChunking}
                      icon={FileBoxIcon}
                      loading={fileStoreState.isCreatingFileParseTask}
                      size={'small'}
                      type={'text'}
                      onClick={() => {
                        fileStoreState.parseFiles([id]);
                      }}
                    >
                      {t(
                        fileStoreState.isCreatingFileParseTask
                          ? 'FileManager.actions.createChunkingTask'
                          : 'FileManager.actions.chunking',
                      )}
                    </Button>
                  </div>
                ) : (
                  <div style={{ cursor: 'default' }}>
                    <ChunksBadge
                      chunkCount={chunkCount}
                      chunkingError={chunkingError}
                      chunkingStatus={chunkingStatus}
                      embeddingError={embeddingError}
                      embeddingStatus={embeddingStatus}
                      finishEmbedding={finishEmbedding}
                      id={id}
                    />
                  </div>
                ))}
              <DropdownMenu className={styles.hover} items={menuItems} />
            </Flexbox>
          </Flexbox>
          {!isDragging && (
            <>
              <Flexbox className={styles.item} style={{ flexShrink: 0 }} width={columnWidths.date}>
                {displayTime}
              </Flexbox>
              <Flexbox className={styles.item} style={{ flexShrink: 0 }} width={columnWidths.size}>
                {isFolder || isPage ? '-' : formatSize(size)}
              </Flexbox>
            </>
          )}
        </Flexbox>
      </ContextMenuTrigger>
    );
  },
  // Custom comparison function to prevent unnecessary re-renders
  (prevProps, nextProps) => {
    return (
      prevProps.id === nextProps.id &&
      prevProps.name === nextProps.name &&
      prevProps.selected === nextProps.selected &&
      prevProps.chunkingStatus === nextProps.chunkingStatus &&
      prevProps.embeddingStatus === nextProps.embeddingStatus &&
      prevProps.chunkCount === nextProps.chunkCount &&
      prevProps.chunkingError === nextProps.chunkingError &&
      prevProps.embeddingError === nextProps.embeddingError &&
      prevProps.finishEmbedding === nextProps.finishEmbedding &&
      prevProps.pendingRenameItemId === nextProps.pendingRenameItemId &&
      prevProps.size === nextProps.size &&
      prevProps.createdAt === nextProps.createdAt &&
      prevProps.fileType === nextProps.fileType &&
      prevProps.sourceType === nextProps.sourceType &&
      prevProps.slug === nextProps.slug &&
      prevProps.url === nextProps.url &&
      prevProps.columnWidths.name === nextProps.columnWidths.name &&
      prevProps.columnWidths.date === nextProps.columnWidths.date &&
      prevProps.columnWidths.size === nextProps.columnWidths.size &&
      prevProps.isAnyRowHovered === nextProps.isAnyRowHovered
    );
  },
);

FileListItem.displayName = 'FileListItem';

export default FileListItem;
