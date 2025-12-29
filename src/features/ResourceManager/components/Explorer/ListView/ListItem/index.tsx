import { Button, Center, Checkbox, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { App, Input } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { isNull } from 'es-toolkit/compat';
import { FileBoxIcon, FileText, FolderIcon } from 'lucide-react';
import { type DragEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  getTransparentDragImage,
  useDragActive,
  useDragState,
} from '@/app/[variants]/(main)/resource/features/DndContextWrapper';
import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import FileIcon from '@/components/FileIcon';
import { fileManagerSelectors, useFileStore } from '@/store/file';
import { type FileListItem as FileListItemType } from '@/types/files';
import { formatSize } from '@/utils/format';
import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';

import DropdownMenu from '../../ItemDropdown/DropdownMenu';
import ChunksBadge from './ChunkTag';

dayjs.extend(relativeTime);

export const FILE_DATE_WIDTH = 160;
export const FILE_SIZE_WIDTH = 140;

const styles = createStaticStyles(({ css }) => {
  return {
    container: css`
      cursor: pointer;

      &:hover {
        background: ${cssVar.colorFillTertiary};

        .file-list-item-hover {
          opacity: 1;
        }
      }
    `,

    dragOver: css`
      color: ${cssVar.colorBgElevated} !important;
      background-color: ${cssVar.colorText} !important;

      * {
        color: ${cssVar.colorBgElevated} !important;
      }
    `,

    dragging: css`
      will-change: transform;
      opacity: 0.5;
    `,

    hover: cx(
      'file-list-item-hover',
      css`
        opacity: 0;
      `,
    ),
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
      text-overflow: ellipsis;
      white-space: nowrap;
    `,
    nameContainer: css`
      overflow: hidden;
      flex: 1;
      min-width: 0;
      max-width: 600px;
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
  index: number;
  onSelectedChange: (id: string, selected: boolean, shiftKey: boolean, index: number) => void;
  pendingRenameItemId?: string | null;
  selected?: boolean;
  slug?: string | null;
}

const FileListItem = memo<FileListItemProps>(
  ({
    size,
    chunkingError,
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
  }) => {
    const { t } = useTranslation(['components', 'file']);
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [, setSearchParams] = useSearchParams();

    const [isCreatingFileParseTask, parseFiles, renameFolder] = useFileStore((s) => [
      fileManagerSelectors.isCreatingFileParseTask(id)(s),
      s.parseFilesToChunks,
      s.renameFolder,
    ]);

    const setPendingRenameItemId = useResourceManagerStore((s) => s.setPendingRenameItemId);

    const [isRenaming, setIsRenaming] = useState(false);
    const [renamingValue, setRenamingValue] = useState(name);
    const inputRef = useRef<any>(null);

    const libraryId = useResourceManagerStore((s) => s.libraryId);
    const isDragActive = useDragActive();
    const { setCurrentDrag } = useDragState();
    const [isDragging, setIsDragging] = useState(false);
    const [isOver, setIsOver] = useState(false);

    // Memoize computed values that don't change
    const computedValues = useMemo(() => {
      const isPDF = fileType?.toLowerCase() === 'pdf' || name?.toLowerCase().endsWith('.pdf');
      return {
        emoji: sourceType === 'document' || fileType === 'custom/document' ? metadata?.emoji : null,
        isFolder: fileType === 'custom/folder',
        // PDF files should not be treated as pages, even if they have sourceType='document'
        isPage: !isPDF && (sourceType === 'document' || fileType === 'custom/document'),
        isSupportedForChunking: !isChunkingUnsupported(fileType),
      };
    }, [fileType, sourceType, metadata?.emoji, name]);

    const { isSupportedForChunking, isPage, isFolder, emoji } = computedValues;

    // Memoize drag data to prevent recreation
    const dragData = useMemo(
      () => ({
        fileType,
        isFolder,
        name,
        sourceType,
      }),
      [fileType, isFolder, name, sourceType],
    );

    // Native HTML5 drag event handlers
    const handleDragStart = useCallback(
      (e: DragEvent) => {
        if (!libraryId) {
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
      [libraryId, dragData, id, isFolder, setCurrentDrag],
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
      // Clear the highlight after drop
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

    const handleRenameStart = () => {
      setIsRenaming(true);
      setRenamingValue(name);
      // Focus input after render
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    };

    const setMode = useResourceManagerStore((s) => s.setMode);
    const setCurrentViewItemId = useResourceManagerStore((s) => s.setCurrentViewItemId);

    const handleRenameConfirm = async () => {
      if (!renamingValue.trim()) {
        message.error(t('FileManager.actions.renameError'));
        return;
      }

      if (renamingValue.trim() === name) {
        setIsRenaming(false);
        return;
      }

      try {
        await renameFolder(id, renamingValue.trim());
        message.success(t('FileManager.actions.renameSuccess'));
        setIsRenaming(false);
      } catch (error) {
        console.error('Rename error:', error);
        message.error(t('FileManager.actions.renameError'));
      }
    };

    const handleRenameCancel = () => {
      setIsRenaming(false);
      setRenamingValue(name);
    };

    // Auto-start renaming if this is the pending rename item
    useEffect(() => {
      if (pendingRenameItemId === id && isFolder && !isRenaming) {
        handleRenameStart();
        // Clear the pending rename item after triggering
        setPendingRenameItemId(null);
      }
    }, [pendingRenameItemId, id, isFolder]);

    return (
      <Flexbox
        align={'center'}
        className={cx(
          styles.container,
          selected && styles.selected,
          isDragging && styles.dragging,
          isOver && styles.dragOver,
        )}
        data-drop-target-id={id}
        data-is-folder={String(isFolder)}
        draggable={!!libraryId}
        height={48}
        horizontal
        onDragEnd={handleDragEnd}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart}
        onDrop={handleDrop}
        paddingInline={8}
        style={{
          borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}`,
        }}
      >
        <Flexbox
          align={'center'}
          className={styles.item}
          distribution={'space-between'}
          flex={1}
          horizontal
          onClick={() => {
            if (isFolder) {
              // Navigate to folder using slug-based routing (Google Drive style)
              const folderSlug = slug || id;

              if (libraryId) {
                navigate(`/resource/library/${libraryId}/${folderSlug}`);
              }
            } else if (isPage) {
              setCurrentViewItemId(id);
              setMode('page');
              setSearchParams(
                (prev) => {
                  const newParams = new URLSearchParams(prev);
                  newParams.set('file', id);
                  return newParams;
                },
                { replace: true },
              );
            } else {
              // Set mode to file and store the file ID
              setCurrentViewItemId(id);
              setMode('editor');
              // Also update URL query parameter for shareable links
              setSearchParams(
                (prev) => {
                  const newParams = new URLSearchParams(prev);
                  newParams.set('file', id);
                  return newParams;
                },
                { replace: true },
              );
            }
          }}
        >
          <Flexbox align={'center'} className={styles.nameContainer} horizontal>
            <Center
              height={48}
              onClick={(e) => {
                e.stopPropagation();

                onSelectedChange(id, !selected, e.shiftKey, index);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              style={{ paddingInline: 4 }}
            >
              <Checkbox checked={selected} />
            </Center>
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
                onBlur={handleRenameConfirm}
                onChange={(e) => setRenamingValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleRenameConfirm();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    handleRenameCancel();
                  }
                }}
                onPointerDown={(e) => e.stopPropagation()}
                ref={inputRef}
                size="small"
                style={{ flex: 1, maxWidth: 400 }}
                value={renamingValue}
              />
            ) : (
              <span className={styles.name}>{name || t('file:pageList.untitled')}</span>
            )}
          </Flexbox>
          <Flexbox
            align={'center'}
            gap={8}
            horizontal
            onClick={(e) => {
              e.stopPropagation();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {!isFolder &&
              (isCreatingFileParseTask || isNull(chunkingStatus) || !chunkingStatus ? (
                <div className={isCreatingFileParseTask ? undefined : styles.hover}>
                  <Tooltip
                    styles={{
                      root: { pointerEvents: 'none' },
                    }}
                    title={t(
                      isSupportedForChunking
                        ? 'FileManager.actions.chunkingTooltip'
                        : 'FileManager.actions.chunkingUnsupported',
                    )}
                  >
                    <Button
                      disabled={!isSupportedForChunking}
                      icon={FileBoxIcon}
                      loading={isCreatingFileParseTask}
                      onClick={() => {
                        parseFiles([id]);
                      }}
                      size={'small'}
                      type={'text'}
                    >
                      {t(
                        isCreatingFileParseTask
                          ? 'FileManager.actions.createChunkingTask'
                          : 'FileManager.actions.chunking',
                      )}
                    </Button>
                  </Tooltip>
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
            <div className={styles.hover}>
              <DropdownMenu
                fileType={fileType}
                filename={name}
                id={id}
                knowledgeBaseId={libraryId}
                onRenameStart={isFolder ? handleRenameStart : undefined}
                sourceType={sourceType}
                url={url}
              />
            </div>
          </Flexbox>
        </Flexbox>
        {!isDragging && (
          <>
            <Flexbox className={styles.item} width={FILE_DATE_WIDTH}>
              {displayTime}
            </Flexbox>
            <Flexbox className={styles.item} width={FILE_SIZE_WIDTH}>
              {isFolder || isPage ? '-' : formatSize(size)}
            </Flexbox>
          </>
        )}
      </Flexbox>
    );
  },
);

FileListItem.displayName = 'FileListItem';

export default FileListItem;
