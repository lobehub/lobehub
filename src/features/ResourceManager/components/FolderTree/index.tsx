'use client';

import { ActionIcon, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, FolderIcon, FolderOpenIcon } from 'lucide-react';
import * as m from 'motion/react-m';
import { memo, useCallback } from 'react';

const styles = stylex.create({
  folderHeader: {
    cursor: 'pointer',
    paddingBlock: '4px',
    paddingInline: '8px',
    color: cssVar.colorTextSecondary,
    transition: 'background-color 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
  },
  folderHeaderActive: { color: cssVar.colorText, backgroundColor: cssVar.colorFillSecondary },
});

export interface FolderTreeItem {
  children?: FolderTreeItem[];
  id: string;
  name: string;
  slug?: string | null;
}

interface FolderTreeItemProps {
  expandedFolders: Set<string>;
  item: FolderTreeItem;
  level?: number;
  loadedFolders: Set<string>;
  onFolderClick?: (folderId: string, folderSlug?: string | null) => void;
  onLoadFolder: (folderId: string) => Promise<void>;
  onToggleFolder: (folderId: string) => void;
  selectedKey?: string | null;
}

// Recursive component to render folder tree
export const FolderTreeItemComponent = memo<FolderTreeItemProps>(
  ({
    item,
    level = 0,
    expandedFolders,
    loadedFolders,
    onToggleFolder,
    onLoadFolder,
    selectedKey,
    onFolderClick,
  }) => {
    const itemKey = item.slug || item.id;
    const isExpanded = expandedFolders.has(itemKey);
    // Compare selectedKey with item.id since selectedKey is always the ID
    const isActive = selectedKey === item.id;

    const handleToggle = useCallback(async () => {
      // Toggle folder expansion
      onToggleFolder(itemKey);

      // Load children if not already loaded
      if (!isExpanded && !loadedFolders.has(itemKey)) {
        await onLoadFolder(itemKey);
      }
    }, [itemKey, isExpanded, loadedFolders, onToggleFolder, onLoadFolder]);

    const handleClick = useCallback(() => {
      if (onFolderClick) {
        // Pass both id and slug so the caller can use the id
        onFolderClick(item.id, item.slug);
      }
    }, [item.id, item.slug, onFolderClick]);

    return (
      <Flexbox gap={2}>
        <Flexbox
          horizontal
          align={'center'}
          style={{ paddingInlineStart: level * 16 + 8 }}
          className={
            stylex.props(styles.folderHeader, isActive && styles.folderHeaderActive).className
          }
          onClick={handleClick}
        >
          <m.div
            animate={{ rotate: isExpanded ? 0 : -90 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            <ActionIcon
              icon={ChevronDownIcon}
              size={'small'}
              onClick={(e) => {
                e.stopPropagation();
                handleToggle();
              }}
            />
          </m.div>
          <Flexbox
            horizontal
            align={'center'}
            flex={1}
            gap={8}
            style={{ minHeight: 28, minWidth: 0 }}
          >
            <Icon icon={isExpanded ? FolderOpenIcon : FolderIcon} size={16} />
            <span
              style={{
                flex: 1,
                fontSize: 14,
                lineHeight: '20px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.name}
            </span>
          </Flexbox>
        </Flexbox>

        {isExpanded && item.children && item.children.length > 0 && (
          <m.div
            animate={{ height: 'auto', opacity: 1 }}
            initial={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            <Flexbox gap={2}>
              {item.children.map((child) => (
                <FolderTreeItemComponent
                  expandedFolders={expandedFolders}
                  item={child}
                  key={child.id}
                  level={level + 1}
                  loadedFolders={loadedFolders}
                  selectedKey={selectedKey}
                  onFolderClick={onFolderClick}
                  onLoadFolder={onLoadFolder}
                  onToggleFolder={onToggleFolder}
                />
              ))}
            </Flexbox>
          </m.div>
        )}
      </Flexbox>
    );
  },
);

FolderTreeItemComponent.displayName = 'FolderTreeItemComponent';

interface FolderTreeProps {
  expandedFolders: Set<string>;
  items: FolderTreeItem[];
  loadedFolders: Set<string>;
  onFolderClick?: (folderId: string, folderSlug?: string | null) => void;
  onLoadFolder: (folderId: string) => Promise<void>;
  onToggleFolder: (folderId: string) => void;
  selectedKey?: string | null;
}

const FolderTree = memo<FolderTreeProps>(
  ({
    items,
    expandedFolders,
    loadedFolders,
    onToggleFolder,
    onLoadFolder,
    selectedKey,
    onFolderClick,
  }) => {
    return (
      <Flexbox gap={2}>
        {items.map((item) => (
          <FolderTreeItemComponent
            expandedFolders={expandedFolders}
            item={item}
            key={item.id}
            loadedFolders={loadedFolders}
            selectedKey={selectedKey}
            onFolderClick={onFolderClick}
            onLoadFolder={onLoadFolder}
            onToggleFolder={onToggleFolder}
          />
        ))}
      </Flexbox>
    );
  },
);

FolderTree.displayName = 'FolderTree';

export default FolderTree;
