'use client';

import { CaretDownFilled, LoadingOutlined } from '@ant-design/icons';
import { ActionIcon, Block, Flexbox, Icon, showContextMenu, stopPropagation } from '@lobehub/ui';
import { App, Input } from 'antd';
import { cx } from 'antd-style';
import { FileText, FolderIcon, FolderOpenIcon } from 'lucide-react';
import * as motion from 'motion/react-m';
import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  getTransparentDragImage,
  useDragActive,
  useDragState,
} from '@/app/[variants]/(main)/resource/features/DndContextWrapper';
import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import FileIcon from '@/components/FileIcon';
import { PAGE_FILE_TYPE } from '@/features/ResourceManager/constants';
import { useFileStore } from '@/store/file';

import { useFileItemClick } from '../Explorer/hooks/useFileItemClick';
import { useFileItemDropdown } from '../Explorer/ItemDropdown/useFileItemDropdown';
import { styles } from './styles';
import { clearTreeFolderCache } from './treeState';
import { type TreeItem } from './types';

interface HierarchyNodeProps {
  expandedFolders: Set<string>;
  folderChildrenCache: Map<string, TreeItem[]>;
  item: TreeItem;
  level?: number;
  loadingFolders: Set<string>;
  onLoadFolder: (_: string) => Promise<void>;
  onToggleFolder: (_: string) => void;
  selectedKey: string | null;
  updateKey?: number;
}

// Row component for folder / file tree (virtualized by flattening visible nodes)
export const HierarchyNode = memo<HierarchyNodeProps>(
  ({
    item,
    level = 0,
    expandedFolders,
    loadingFolders,
    onToggleFolder,
    onLoadFolder,
    selectedKey,
    folderChildrenCache,
  }) => {
    const navigate = useNavigate();
    const { message } = App.useApp();

    const [setMode, libraryId] = useResourceManagerStore((s) => [s.setMode, s.libraryId]);

    const renameFolder = useFileStore((s) => s.renameFolder);

    const [isRenaming, setIsRenaming] = useState(false);
    const [renamingValue, setRenamingValue] = useState(item.name);
    const inputRef = useRef<any>(null);

    // Memoize computed values that don't change frequently
    const { itemKey, isPage, emoji } = useMemo(() => {
      const lowerFileType = item.fileType?.toLowerCase();
      const lowerName = item.name?.toLowerCase();
      const isPDF = lowerFileType === 'pdf' || lowerName?.endsWith('.pdf');
      const isOfficeFile =
        lowerName?.endsWith('.xls') ||
        lowerName?.endsWith('.xlsx') ||
        lowerName?.endsWith('.doc') ||
        lowerName?.endsWith('.docx') ||
        lowerName?.endsWith('.ppt') ||
        lowerName?.endsWith('.pptx') ||
        lowerName?.endsWith('.odt');
      const pageMatch =
        !isPDF &&
        !isOfficeFile &&
        (item.sourceType === 'document' || item.fileType === PAGE_FILE_TYPE);

      return {
        emoji: pageMatch ? item.metadata?.emoji : null,
        isPage: pageMatch,
        itemKey: item.slug || item.id,
      };
    }, [item.slug, item.id, item.fileType, item.sourceType, item.name, item.metadata?.emoji]);

    const handleRenameStart = useCallback(() => {
      setIsRenaming(true);
      setRenamingValue(item.name);
      // Focus input after render
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }, [item.name]);

    const handleRenameConfirm = useCallback(async () => {
      if (!renamingValue.trim()) {
        message.error('Folder name cannot be empty');
        return;
      }

      if (renamingValue.trim() === item.name) {
        setIsRenaming(false);
        return;
      }

      try {
        await renameFolder(item.id, renamingValue.trim());
        if (libraryId) {
          await clearTreeFolderCache(libraryId);
        }
        message.success('Renamed successfully');
        setIsRenaming(false);
      } catch (error) {
        console.error('Rename error:', error);
        message.error('Rename failed');
      }
    }, [item.id, item.name, libraryId, renamingValue, renameFolder, message]);

    const handleRenameCancel = useCallback(() => {
      setIsRenaming(false);
      setRenamingValue(item.name);
    }, [item.name]);

    const { menuItems } = useFileItemDropdown({
      fileType: item.fileType,
      filename: item.name,
      id: item.id,
      libraryId,
      onRenameStart: item.isFolder ? handleRenameStart : undefined,
      sourceType: item.sourceType,
      url: item.url,
    });

    const isDragActive = useDragActive();
    const { setCurrentDrag } = useDragState();
    const [isDragging, setIsDragging] = useState(false);
    const [isOver, setIsOver] = useState(false);

    // Memoize drag data to prevent recreation
    const dragData = useMemo(
      () => ({
        fileType: item.fileType,
        isFolder: item.isFolder,
        name: item.name,
        sourceType: item.sourceType,
      }),
      [item.fileType, item.isFolder, item.name, item.sourceType],
    );

    // Native HTML5 drag event handlers
    const handleDragStart = useCallback(
      (e: React.DragEvent<HTMLDivElement>) => {
        setIsDragging(true);
        setCurrentDrag({
          data: dragData,
          id: item.id,
          type: item.isFolder ? 'folder' : 'file',
        });

        // Set drag image to be transparent (we use custom overlay)
        const img = getTransparentDragImage();
        if (img && e.dataTransfer) {
          e.dataTransfer.setDragImage(img, 0, 0);
        }
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
        }
      },
      [dragData, item.id, item.isFolder, setCurrentDrag],
    );

    const handleDragEnd = useCallback(() => {
      setIsDragging(false);
    }, []);

    const handleDragOver = useCallback(
      (e: React.DragEvent<HTMLDivElement>) => {
        if (!item.isFolder || !isDragActive) return;

        e.preventDefault();
        e.stopPropagation();
        setIsOver(true);
      },
      [item.isFolder, isDragActive],
    );

    const handleDragLeave = useCallback(() => {
      setIsOver(false);
    }, []);

    const handleDrop = useCallback(() => {
      // Clear the highlight after drop
      setIsOver(false);
    }, []);

    const handleItemClick = useFileItemClick({
      id: item.id,
      isFolder: item.isFolder,
      isPage,
      libraryId,
      slug: item.slug,
    });

    const handleFolderClick = useCallback(
      (folderId: string, folderSlug?: string | null) => {
        const navKey = folderSlug || folderId;
        navigate(`/resource/library/${libraryId}/${navKey}`);

        setMode('explorer');
      },
      [libraryId, navigate],
    );

    if (item.isFolder) {
      const isExpanded = expandedFolders.has(itemKey);
      const isActive = selectedKey === itemKey;
      const isLoading = loadingFolders.has(itemKey);

      const handleToggle = async () => {
        // Toggle folder expansion
        onToggleFolder(itemKey);

        // Only load if not already cached
        if (!isExpanded && !folderChildrenCache.has(itemKey)) {
          await onLoadFolder(itemKey);
        }
      };

      return (
        <Flexbox gap={2}>
          <Block
            clickable
            draggable
            horizontal
            align={'center'}
            data-drop-target-id={item.id}
            data-is-folder={String(item.isFolder)}
            gap={8}
            height={36}
            paddingInline={4}
            variant={isActive ? 'filled' : 'borderless'}
            className={cx(
              styles.treeItem,
              isOver && styles.fileItemDragOver,
              isDragging && styles.dragging,
            )}
            style={{
              paddingInlineStart: level * 12 + 4,
            }}
            onClick={() => handleFolderClick(item.id, item.slug)}
            onDragEnd={handleDragEnd}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            onContextMenu={(e) => {
              e.preventDefault();
              showContextMenu(menuItems());
            }}
          >
            {isLoading ? (
              <ActionIcon spin icon={LoadingOutlined as any} size={'small'} style={{ width: 20 }} />
            ) : (
              <motion.div
                animate={{ rotate: isExpanded ? 0 : -90 }}
                initial={false}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
              >
                <ActionIcon
                  icon={CaretDownFilled as any}
                  size={'small'}
                  style={{ width: 20 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggle();
                  }}
                />
              </motion.div>
            )}
            <Flexbox
              horizontal
              align={'center'}
              flex={1}
              gap={8}
              style={{ minHeight: 28, minWidth: 0, overflow: 'hidden' }}
            >
              <Icon icon={isExpanded ? FolderOpenIcon : FolderIcon} size={18} />
              {isRenaming ? (
                <Input
                  ref={inputRef}
                  size="small"
                  style={{ flex: 1 }}
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
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.name}
                </span>
              )}
            </Flexbox>
          </Block>
        </Flexbox>
      );
    }

    // Render as file
    const isActive = selectedKey === itemKey;
    return (
      <Flexbox gap={2}>
        <Block
          clickable
          draggable
          horizontal
          align={'center'}
          className={cx(styles.treeItem, isDragging && styles.dragging)}
          data-drop-target-id={item.id}
          data-is-folder={false}
          gap={8}
          height={36}
          paddingInline={4}
          variant={isActive ? 'filled' : 'borderless'}
          style={{
            paddingInlineStart: level * 12 + 4,
          }}
          onClick={handleItemClick}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
          onContextMenu={(e) => {
            e.preventDefault();
            showContextMenu(menuItems());
          }}
        >
          <div style={{ width: 20 }} />
          <Flexbox
            horizontal
            align={'center'}
            flex={1}
            gap={8}
            style={{ minHeight: 28, minWidth: 0, overflow: 'hidden' }}
          >
            {isPage ? (
              emoji ? (
                <span style={{ fontSize: 18 }}>{emoji}</span>
              ) : (
                <Icon icon={FileText} size={18} />
              )
            ) : (
              <FileIcon fileName={item.name} fileType={item.fileType} size={18} />
            )}
            <span
              style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.name}
            </span>
          </Flexbox>
        </Block>
      </Flexbox>
    );
  },
);

HierarchyNode.displayName = 'HierarchyNode';
