import {
  Center,
  Checkbox,
  ContextMenuTrigger,
  createStaticStyles,
  cssVar,
  cx,
  Flexbox,
  Tooltip,
} from '@lobehub/ui';
import { isEqual } from 'es-toolkit';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import UserAvatar from '@/components/UserAvatar';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { isExplorerItemSelected } from '@/features/ResourceManager/store/selectors';
import { fileManagerSelectors, getChunkTargetId, useFileStore } from '@/store/file';
import type { FileListItem as FileListItemType } from '@/types/files';
import { formatSize } from '@/utils/format';

import { useFileItemClick, useFileItemDoubleClick } from '../../hooks/useFileItemClick';
import { getListViewMinWidth } from './constants';
import FileListItemActions from './FileListItemActions';
import FileListItemMenu, { type FileListItemMenuGetter } from './FileListItemMenu';
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
      min-width: 1040px;
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

    dropAfter: css`
      &,
      &:hover {
        box-shadow: inset 0 -2px 0 0 ${cssVar.colorPrimary};
      }
    `,

    dropBefore: css`
      &,
      &:hover {
        box-shadow: inset 0 2px 0 0 ${cssVar.colorPrimary};
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
    menuPlaceholder: css`
      cursor: pointer;

      flex-shrink: 0;

      width: 24px;
      height: 24px;
      padding: 0;
      border: none;

      background: transparent;
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
    uploaderName: css`
      overflow: hidden;
      flex: 1;

      min-width: 0;

      text-overflow: ellipsis;
      white-space: nowrap;
    `,
  };
});

interface FileListItemProps extends FileListItemType {
  allowReorder?: boolean;
  columnWidths: {
    date: number;
    name: number;
    size: number;
    uploader: number;
  };
  index: number;
  onSelectedChange: (id: string, selected: boolean, shiftKey: boolean, index: number) => void;
  selectable?: boolean;
  selected?: boolean;
  showUploader?: boolean;
  slug?: string | null;
}

const FileListItem = ({
  allowReorder = true,
  chunkCount,
  chunkingError,
  chunkingStatus,
  columnWidths,
  createdAt,
  embeddingError,
  embeddingStatus,
  fileId,
  fileType,
  finishEmbedding,
  id,
  index,
  knowledgeBaseIds,
  metadata,
  name,
  onSelectedChange,
  parentId,
  selectable = true,
  selected,
  showUploader = true,
  size,
  sourceType,
  uploader,
  url,
  userId,
  visibility,
}: FileListItemProps) => {
  const { t } = useTranslation(['components', 'file', 'chat', 'common']);
  const uploaderName =
    uploader?.fullName || uploader?.username || (uploader?.id ? uploader.id.slice(0, 8) : '');
  const chunkTargetId = getChunkTargetId({ fileId, id });
  const fileStoreState = useFileStore(
    (s) => ({
      isCreatingFileParseTask: fileManagerSelectors.isCreatingFileParseTask(chunkTargetId)(s),
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

  // Personal mode has no second audience, so `visibility` carries no meaning
  // there and every row would wear a lock for nothing.
  const activeWorkspaceId = useActiveWorkspaceId();
  const isPrivate = Boolean(activeWorkspaceId) && visibility === 'private';
  const {
    dropPosition,
    handleDragEnd,
    handleDragLeave,
    handleDragOver,
    handleDragStart,
    handleDrop,
    isDragging,
    parentKey,
  } = useFileListItemDrag({
    allowReorder,
    fileType,
    id,
    isFolder,
    itemParentId: parentId,
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
    openInPanel: true,
  });
  const handleItemDoubleClick = useFileItemDoubleClick({
    id,
    isPage,
    libraryId: resourceManagerState.libraryId,
  });

  // The row menu (its hooks plus a Base UI menu tree) mounts on first hover or
  // focus instead of for every row Virtuoso renders; scrolling a long list used
  // to mount and tear down dozens of closed menus per frame.
  const [menuActivation, setMenuActivation] = useState<'click' | 'focus' | 'pointer' | null>(null);
  const menuActivated = menuActivation !== null;
  const activateMenu = useCallback(() => setMenuActivation((prev) => prev ?? 'pointer'), []);
  // Keyboard users reach the placeholder trigger first; hand focus to the real
  // trigger once it mounts so Tab/Enter keep working.
  const activateMenuFromFocus = useCallback(() => setMenuActivation((prev) => prev ?? 'focus'), []);
  // A click on the placeholder (assistive tech, programmatic `click()`) opens
  // the real menu right away instead of only swapping the trigger in.
  const activateMenuFromClick = useCallback(() => setMenuActivation((prev) => prev ?? 'click'), []);
  const menuItemsRef = useRef<FileListItemMenuGetter | null>(null);
  const getContextMenuItems = useCallback(() => menuItemsRef.current?.() ?? [], []);

  const rowMenu = menuActivated ? (
    <FileListItemMenu
      className={styles.hover}
      fileId={fileId}
      fileType={fileType}
      filename={name}
      focusOnMount={menuActivation === 'focus' || menuActivation === 'click'}
      id={id}
      isFolder={isFolder}
      isPage={isPage}
      libraryId={resourceManagerState.libraryId}
      menuItemsRef={menuItemsRef}
      openOnMount={menuActivation === 'click'}
      size={size}
      sourceType={sourceType}
      url={url}
      userId={userId}
      visibility={visibility}
      onRenameStart={isFolder ? handleRenameStart : undefined}
    />
  ) : (
    <button
      aria-haspopup="menu"
      aria-label={t('more', { ns: 'common' })}
      className={cx(styles.menuPlaceholder, styles.hover)}
      type="button"
      onClick={activateMenuFromClick}
      onFocus={activateMenuFromFocus}
    />
  );

  const handleCheckboxClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectable) return;
      onSelectedChange(id, !isSelected, e.shiftKey, index);
    },
    [id, index, isSelected, onSelectedChange, selectable],
  );

  const handleCheckboxPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.shiftKey) {
      e.preventDefault();
    }
  }, []);

  return (
    <ContextMenuTrigger items={menuActivated ? getContextMenuItems : undefined}>
      <Flexbox
        horizontal
        align={'center'}
        data-allow-reorder={allowReorder ? undefined : 'false'}
        data-drop-item="true"
        data-drop-target-id={id}
        data-is-folder={String(isFolder)}
        data-parent-key={parentKey}
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
          dropPosition === 'inside' && styles.dragOver,
          dropPosition === 'before' && styles.dropBefore,
          dropPosition === 'after' && styles.dropAfter,
        )}
        style={{
          borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}`,
          minWidth: getListViewMinWidth(showUploader),
          userSelect: 'none',
        }}
        onClick={handleItemClick}
        onDoubleClick={handleItemDoubleClick}
        onDragEnd={handleDragEnd}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart}
        onDrop={handleDrop}
        onFocus={menuActivated ? undefined : activateMenu}
        onPointerEnter={menuActivated ? undefined : activateMenu}
      >
        <Center
          height={40}
          style={{ cursor: selectable ? 'pointer' : 'not-allowed', paddingInline: 4 }}
          title={selectable ? undefined : t('FileManager.selection.onlyOwn')}
          onClick={handleCheckboxClick}
          onPointerDown={handleCheckboxPointerDown}
        >
          <Checkbox checked={isSelected} disabled={!selectable} />
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
            isPrivate={isPrivate}
            isRenaming={isRenaming}
            knowledgeBaseIds={resourceManagerState.libraryId ? undefined : knowledgeBaseIds}
            name={name}
            privateTooltip={t('resources.visibility.privateTooltip', { ns: 'chat' })}
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
            fileId={fileId}
            finishEmbedding={finishEmbedding}
            id={id}
            isCreatingFileParseTask={fileStoreState.isCreatingFileParseTask}
            isFolder={isFolder}
            isPage={isPage}
            isSupportedForChunking={isSupportedForChunking}
            menu={rowMenu}
            parseFiles={fileStoreState.parseFiles}
            t={t}
          />
        </Flexbox>
        {!isDragging && (
          <>
            <Flexbox
              horizontal
              align={'center'}
              className={styles.item}
              gap={8}
              style={{ flexShrink: 0 }}
              width={columnWidths.date}
            >
              <span>{displayTime}</span>
            </Flexbox>
            {showUploader && (
              <Flexbox
                horizontal
                align={'center'}
                className={styles.item}
                gap={8}
                style={{ flexShrink: 0 }}
                width={columnWidths.uploader}
              >
                {uploaderName ? (
                  <Tooltip title={t('file:listView.uploadedBy', { name: uploaderName })}>
                    <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
                      <UserAvatar
                        avatar={uploader?.avatar}
                        name={uploaderName}
                        shape={'circle'}
                        size={20}
                        style={{ flexShrink: 0 }}
                      />
                      <span className={styles.uploaderName}>{uploaderName}</span>
                    </Flexbox>
                  </Tooltip>
                ) : (
                  '-'
                )}
              </Flexbox>
            )}
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
