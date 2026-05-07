'use client';

import type { SkillResourceTreeNode } from '@lobechat/types';
import type { MenuProps } from '@lobehub/ui';
import { ContextMenuTrigger, Icon } from '@lobehub/ui';
import { Input, type InputRef } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ChevronDown, ChevronRight, File, FolderIcon, FolderOpenIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  item: css`
    cursor: pointer;

    display: flex;
    gap: 6px;
    align-items: center;

    padding-block: 6px;
    padding-inline-end: 8px;
    border-radius: 6px;

    font-size: 13px;
    line-height: 1.4;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  itemSelected: css`
    color: ${cssVar.colorPrimary};
    background: ${cssVar.colorFillSecondary};
  `,
  label: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  // Inline rename should look like plain filename text.
  // Ant Input adds default spacing/border/font styles (and `size="small"` adds extra scaling),
  // so we fully neutralize visual chrome to avoid layout jump when entering edit mode.
  editingInput: css`
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;

    font-size: 13px !important;
    line-height: 1.4 !important;

    background: transparent !important;
    outline: none !important;
    box-shadow: none !important;
  `,
  // Reset wrapper-level styles too; Ant applies some padding/radius on the semantic root.
  // If only `input` is reset, the row can still shift by a few pixels.
  editingInputRoot: css`
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    border-radius: 0 !important;

    background: transparent !important;
    box-shadow: none !important;
  `,
}));

interface FileTreeProps {
  editableFilePath?: string | null;
  getFileContextMenuItems?: (file: { name: string; path: string }) => MenuProps['items'];
  onCancelRenameFile?: () => void;
  onCommitRenameFile?: (
    file: { name: string; path: string },
    newName: string,
  ) => Promise<void> | void;
  onSelectFile: (path: string) => void;
  resourceTree: SkillResourceTreeNode[];
  rootFile?: {
    label: string;
    path: string;
  } | null;
  selectedFile: string;
}

const TreeNode = memo<{
  depth: number;
  editableFilePath?: string | null;
  expandedFolders: Set<string>;
  getFileContextMenuItems?: (file: { name: string; path: string }) => MenuProps['items'];
  node: SkillResourceTreeNode;
  onCancelRenameFile?: () => void;
  onCommitRenameFile?: (
    file: { name: string; path: string },
    newName: string,
  ) => Promise<void> | void;
  onSelectFile: (_path: string) => void;
  onToggleFolder: (_path: string) => void;
  selectedFile: string;
}>(
  ({
    node,
    depth,
    selectedFile,
    onSelectFile,
    expandedFolders,
    onToggleFolder,
    getFileContextMenuItems,
    editableFilePath,
    onCancelRenameFile,
    onCommitRenameFile,
  }) => {
    const isDir = node.type === 'directory';
    const isExpanded = expandedFolders.has(node.path);
    const isSelected = !isDir && selectedFile === node.path;
    const isEditing = !isDir && editableFilePath === node.path && !!onCommitRenameFile;
    const [editingName, setEditingName] = useState(node.name);
    const inputRef = useRef<InputRef>(null);
    const isSubmittingRef = useRef(false);

    useEffect(() => {
      if (!isEditing) return;

      setEditingName(node.name);
      requestAnimationFrame(() => {
        inputRef.current?.focus?.();
        inputRef.current?.select?.();
      });
    }, [isEditing, node.name]);

    const handleClick = () => {
      if (isEditing) return;

      if (isDir) {
        onToggleFolder(node.path);
      } else {
        onSelectFile(node.path);
      }
    };

    const handleCancelRename = useCallback(() => {
      setEditingName(node.name);
      onCancelRenameFile?.();
    }, [node.name, onCancelRenameFile]);

    const handleCommitRename = useCallback(async () => {
      if (!isEditing || !onCommitRenameFile || isSubmittingRef.current) return;

      const nextName = editingName.trim();
      if (nextName === node.name) {
        handleCancelRename();
        return;
      }

      isSubmittingRef.current = true;
      try {
        await onCommitRenameFile({ name: node.name, path: node.path }, nextName);
        onCancelRenameFile?.();
      } finally {
        isSubmittingRef.current = false;
      }
    }, [
      editingName,
      handleCancelRename,
      isEditing,
      node.name,
      node.path,
      onCancelRenameFile,
      onCommitRenameFile,
    ]);

    const contextMenuItems =
      !isDir && !isEditing
        ? getFileContextMenuItems?.({ name: node.name, path: node.path })
        : undefined;

    const nodeContent = (
      <div
        className={`${styles.item} ${isSelected ? styles.itemSelected : ''}`}
        style={{ paddingInlineStart: 8 + depth * 16 }}
        title={node.path}
        onClick={handleClick}
      >
        {isDir && <Icon icon={isExpanded ? ChevronDown : ChevronRight} size={14} />}
        {!isDir && <span style={{ flexShrink: 0, width: 14 }} />}
        <Icon icon={isDir ? (isExpanded ? FolderOpenIcon : FolderIcon) : File} size={16} />
        {isEditing ? (
          <Input
            classNames={{ input: styles.editingInput, root: styles.editingInputRoot }}
            ref={inputRef}
            value={editingName}
            variant={'borderless'}
            onBlur={() => void handleCommitRename()}
            onChange={(e) => setEditingName(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
                void handleCommitRename();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                handleCancelRename();
              }
            }}
          />
        ) : (
          <span className={styles.label}>{node.name}</span>
        )}
      </div>
    );

    return (
      <>
        {!isDir && contextMenuItems && contextMenuItems.length > 0 ? (
          <ContextMenuTrigger items={contextMenuItems}>{nodeContent}</ContextMenuTrigger>
        ) : (
          nodeContent
        )}
        {isDir &&
          isExpanded &&
          node.children?.map((child) => (
            <TreeNode
              depth={depth + 1}
              editableFilePath={editableFilePath}
              expandedFolders={expandedFolders}
              getFileContextMenuItems={getFileContextMenuItems}
              key={child.path}
              node={child}
              selectedFile={selectedFile}
              onCancelRenameFile={onCancelRenameFile}
              onCommitRenameFile={onCommitRenameFile}
              onSelectFile={onSelectFile}
              onToggleFolder={onToggleFolder}
            />
          ))}
      </>
    );
  },
);

TreeNode.displayName = 'TreeNode';

const FileTree = memo<FileTreeProps>(
  ({
    resourceTree,
    rootFile,
    selectedFile,
    onSelectFile,
    getFileContextMenuItems,
    editableFilePath,
    onCancelRenameFile,
    onCommitRenameFile,
  }) => {
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());

    useEffect(() => {
      // Expand all directories by default when tree is loaded
      const allDirs = new Set<string>();
      const collectDirs = (nodes: SkillResourceTreeNode[]) => {
        for (const node of nodes) {
          if (node.type === 'directory') {
            allDirs.add(node.path);
            if (node.children) collectDirs(node.children);
          }
        }
      };
      collectDirs(resourceTree);
      setExpandedFolders(allDirs);
    }, [resourceTree]);

    const handleToggleFolder = useCallback((path: string) => {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
    }, []);

    const rootFilePath = rootFile === undefined ? 'SKILL.md' : rootFile?.path;
    const rootFileLabel = rootFile === undefined ? 'SKILL.md' : rootFile?.label;
    const isRootFileSelected = !!rootFilePath && selectedFile === rootFilePath;

    const hasResources = useMemo(() => resourceTree.length > 0, [resourceTree]);
    const rootFileContextMenuItems = useMemo(
      () =>
        rootFilePath && rootFileLabel
          ? getFileContextMenuItems?.({ name: rootFileLabel, path: rootFilePath })
          : undefined,
      [getFileContextMenuItems, rootFileLabel, rootFilePath],
    );

    const rootFileContent = rootFilePath && rootFileLabel && (
      <div
        className={`${styles.item} ${isRootFileSelected ? styles.itemSelected : ''}`}
        style={{ paddingInlineStart: 8 }}
        onClick={() => onSelectFile(rootFilePath)}
      >
        <span style={{ flexShrink: 0, width: 14 }} />
        <Icon icon={File} size={16} />
        <span className={styles.label}>{rootFileLabel}</span>
      </div>
    );

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rootFileContent && rootFileContextMenuItems && rootFileContextMenuItems.length > 0 ? (
          <ContextMenuTrigger items={rootFileContextMenuItems}>
            {rootFileContent}
          </ContextMenuTrigger>
        ) : (
          rootFileContent
        )}
        {hasResources &&
          resourceTree.map((node) => (
            <TreeNode
              depth={0}
              editableFilePath={editableFilePath}
              expandedFolders={expandedFolders}
              getFileContextMenuItems={getFileContextMenuItems}
              key={node.path}
              node={node}
              selectedFile={selectedFile}
              onCancelRenameFile={onCancelRenameFile}
              onCommitRenameFile={onCommitRenameFile}
              onSelectFile={onSelectFile}
              onToggleFolder={handleToggleFolder}
            />
          ))}
      </div>
    );
  },
);

FileTree.displayName = 'FileTree';

export { default as FileTreeSkeleton } from './Skeleton';

export default FileTree;
