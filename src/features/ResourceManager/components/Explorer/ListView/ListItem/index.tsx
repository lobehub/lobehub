import { Center, Checkbox, ContextMenuTrigger, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { isEqual } from 'es-toolkit';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import { isExplorerItemSelected } from '@/routes/(main)/resource/features/store/selectors';
import { fileManagerSelectors, useFileStore } from '@/store/file';
import type { FileListItem as FileListItemType } from '@/types/files';
import { formatSize } from '@/utils/format';

import { useFileItemClick } from '../../hooks/useFileItemClick';
import { useFileItemDropdown } from '../../ItemDropdown/useFileItemDropdown';
import FileListItemActions from './FileListItemActions';
import FileListItemName from './FileListItemName';
import { useFileListItemDrag } from './useFileListItemDrag';
import { useFileListItemMeta } from './useFileListItemMeta';
import { useFileListItemRename } from './useFileListItemRename';

export const FILE_DATE_WIDTH = 160;
export const FILE_SIZE_WIDTH = 140;

const styles = createStaticStyles(({ css }) => {
  return {
    container: css`
      cursor: pointer;
      min-width: 800px;
      transition: background ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut};

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
  onSelectedChange: (id: string, selected: boolean, shiftKey: boolean, index: number) => void;
  selected?: boolean;
  slug?: string | null;
}

const FileListItem = ({
  chunkCount,
  chunkingError,
  chunkingStatus,
  columnWidths,
  createdAt,
  embeddingError,
  embeddingStatus,
  fileType,
  finishEmbedding,
  id,
  index,
  metadata,
  name,
  onSelectedChange,
  selected,
  size,
  slug,
  sourceType,
  url,
}: FileListItemProps) => {
  const { t } = useTranslation(['components', 'file']);
  const fileStoreState = useFileStore(
    (s) => ({
      isCreatingFileParseTask: fileManagerSelectors.isCreatingFileParseTask(id)(s),
      parseFiles: s.parseFilesToChunks,
      refreshFileList: s.refreshFileList,
      updateResource: s.updateResource,
    }),
    isEqual,
  );
  const resourceManagerState = useResourceManagerStore(
    (s) => ({
      isPendingRename: s.pendingRenameItemId === id,
      libraryId: s.libraryId,
      selected: isExplorerItemSelected({
        id,
        selectAllState: s.selectAllState,
        selectedIds: s.selectedFileIds,
      }),
      setPendingRenameItemId: s.setPendingRenameItemId,
    }),
    shallow,
  );
  const isSelected = selected ?? resourceManagerState.selected;

  const { displayTime, emoji, isFolder, isPage, isSupportedForChunking } = useFileListItemMeta({
    createdAt,
    fileType,
    metadata,
    name,
    sourceType,
  });
  const {
    handleDragEnd,
    handleDragLeave,
    handleDragOver,
    handleDragStart,
    handleDrop,
    isDragging,
    isOver,
  } = useFileListItemDrag({
    fileType,
    id,
    isFolder,
    libraryId: resourceManagerState.libraryId,
    name,
    sourceType,
  });
  const {
    handleRenameCancel,
    handleRenameConfirm,
    handleRenameStart,
    inputRef,
    isRenaming,
    renamingValue,
    setRenamingValue,
  } = useFileListItemRename({
    id,
    isPendingRename: resourceManagerState.isPendingRename,
    isFolder,
    libraryId: resourceManagerState.libraryId,
    name,
    refreshFileList: fileStoreState.refreshFileList,
    setPendingRenameItemId: resourceManagerState.setPendingRenameItemId,
    updateResource: fileStoreState.updateResource,
  });

  const handleItemClick = useFileItemClick({
    id,
    isFolder,
    isPage,
    libraryId: resourceManagerState.libraryId,
    slug,
  });
  const { menuItems } = useFileItemDropdown({
    fileType,
    filename: name,
    id,
    libraryId: resourceManagerState.libraryId,
    onRenameStart: isFolder ? handleRenameStart : undefined,
    sourceType,
    url,
  });

  const handleCheckboxClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelectedChange(id, !isSelected, e.shiftKey, index);
    },
    [id, index, isSelected, onSelectedChange],
  );

  const handleCheckboxPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.shiftKey) {
      e.preventDefault();
    }
  }, []);

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
          isSelected && styles.selected,
          isDragging && styles.dragging,
          isOver && styles.dragOver,
        )}
        style={{
          borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}`,
          userSelect: 'none',
        }}
        onClick={handleItemClick}
        onDragEnd={handleDragEnd}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart}
        onDrop={handleDrop}
      >
        <Center
          height={40}
          style={{ paddingInline: 4 }}
          onClick={handleCheckboxClick}
          onPointerDown={handleCheckboxPointerDown}
        >
          <Checkbox checked={isSelected} />
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
        >
          <FileListItemName
            emoji={emoji}
            fallbackName={t('file:pageList.untitled')}
            fileType={fileType}
            inputRef={inputRef}
            isFolder={isFolder}
            isPage={isPage}
            isRenaming={isRenaming}
            name={name}
            renamingValue={renamingValue}
            onRenameCancel={handleRenameCancel}
            onRenameConfirm={handleRenameConfirm}
            onRenamingValueChange={setRenamingValue}
          />
          <FileListItemActions
            chunkCount={chunkCount}
            chunkingError={chunkingError}
            chunkingStatus={chunkingStatus}
            embeddingError={embeddingError}
            embeddingStatus={embeddingStatus}
            finishEmbedding={finishEmbedding}
            id={id}
            isCreatingFileParseTask={fileStoreState.isCreatingFileParseTask}
            isFolder={isFolder}
            isPage={isPage}
            isSupportedForChunking={isSupportedForChunking}
            menuItems={menuItems}
            parseFiles={fileStoreState.parseFiles}
            t={t}
          />
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
};

export default memo(FileListItem);
