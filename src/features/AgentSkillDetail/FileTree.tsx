'use client';

import type { SkillResourceTreeNode } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronDown, ChevronRight, File, FolderIcon, FolderOpenIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

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
}));

interface FileTreeProps {
  onSelectFile: (path: string) => void;
  resourceTree: SkillResourceTreeNode[];
  selectedFile: string;
}

const TreeNode = memo<{
  depth: number;
  expandedFolders: Set<string>;
  node: SkillResourceTreeNode;
  onSelectFile: (_path: string) => void;
  onToggleFolder: (_path: string) => void;
  selectedFile: string;
}>(({ node, depth, selectedFile, onSelectFile, expandedFolders, onToggleFolder }) => {
  const isDir = node.type === 'directory';
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = !isDir && selectedFile === node.path;

  const handleClick = () => {
    if (isDir) {
      onToggleFolder(node.path);
    } else {
      onSelectFile(node.path);
    }
  };

  return (
    <>
      <div
        className={`${styles.item} ${isSelected ? styles.itemSelected : ''}`}
        onClick={handleClick}
        style={{ paddingInlineStart: 8 + depth * 16 }}
        title={node.path}
      >
        {isDir && <Icon icon={isExpanded ? ChevronDown : ChevronRight} size={14} />}
        {!isDir && <span style={{ flexShrink: 0, width: 14 }} />}
        <Icon icon={isDir ? (isExpanded ? FolderOpenIcon : FolderIcon) : File} size={16} />
        <span className={styles.label}>{node.name}</span>
      </div>
      {isDir &&
        isExpanded &&
        node.children?.map((child) => (
          <TreeNode
            depth={depth + 1}
            expandedFolders={expandedFolders}
            key={child.path}
            node={child}
            onSelectFile={onSelectFile}
            onToggleFolder={onToggleFolder}
            selectedFile={selectedFile}
          />
        ))}
    </>
  );
});

TreeNode.displayName = 'TreeNode';

const FileTree = memo<FileTreeProps>(({ resourceTree, selectedFile, onSelectFile }) => {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

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

  const isSkillMdSelected = selectedFile === 'SKILL.md';

  const hasResources = useMemo(() => resourceTree.length > 0, [resourceTree]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div
        className={`${styles.item} ${isSkillMdSelected ? styles.itemSelected : ''}`}
        onClick={() => onSelectFile('SKILL.md')}
        style={{ paddingInlineStart: 8 }}
      >
        <span style={{ flexShrink: 0, width: 14 }} />
        <Icon icon={File} size={16} />
        <span className={styles.label}>SKILL.md</span>
      </div>
      {hasResources &&
        resourceTree.map((node) => (
          <TreeNode
            depth={0}
            expandedFolders={expandedFolders}
            key={node.path}
            node={node}
            onSelectFile={onSelectFile}
            onToggleFolder={handleToggleFolder}
            selectedFile={selectedFile}
          />
        ))}
    </div>
  );
});

FileTree.displayName = 'FileTree';

export default FileTree;
