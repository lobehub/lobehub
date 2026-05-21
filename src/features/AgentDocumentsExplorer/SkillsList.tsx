import { Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { createStaticStyles } from 'antd-style';
import { ChevronRightIcon, FileIcon, FolderIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';

export interface SkillListItem {
  description?: string;
  fileCount: number;
  files: string[];
  id: string;
  name: string;
}

interface SkillsListProps {
  items: SkillListItem[];
  onOpenFile?: (item: SkillListItem, relativePath: string) => void;
  onOpenSkill?: (item: SkillListItem) => void;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  chevron: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
    transition: transform ${cssVar.motionDurationFast} ${cssVar.motionEaseInOut};
  `,
  chevronExpanded: css`
    transform: rotate(90deg);
  `,
  childItem: css`
    cursor: pointer;

    height: 26px;
    padding-inline-end: 8px;
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  childItemIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  description: css`
    max-width: 320px;
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  item: css`
    cursor: pointer;

    height: 28px;
    padding-inline: 4px 8px;
    border-radius: 6px;

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  itemCount: css`
    flex-shrink: 0;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  itemIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  treeChevronSlot: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 14px;
    height: 14px;
  `,
}));

interface TreeNode {
  children: TreeNode[];
  isDirectory: boolean;
  name: string;
  path: string;
}

const buildSkillTree = (paths: string[]): TreeNode[] => {
  const root: TreeNode = { children: [], isDirectory: true, name: '', path: '' };

  for (const fullPath of paths) {
    const parts = fullPath.split('/').filter(Boolean);
    let current = root;
    let accumPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      accumPath = accumPath ? `${accumPath}/${part}` : part;
      const isDirectory = i < parts.length - 1;

      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = { children: [], isDirectory, name: part, path: accumPath };
        current.children.push(child);
      }
      current = child;
    }
  }

  const sortNode = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const child of node.children) sortNode(child);
  };
  sortNode(root);

  return root.children;
};

const TREE_BASE_INSET = 24;
const TREE_DEPTH_INDENT = 14;

interface TreeRowProps {
  depth: number;
  expanded: Set<string>;
  node: TreeNode;
  onOpenFile: (relativePath: string) => void;
  onToggleFolder: (folderPath: string) => void;
}

const TreeRow = memo<TreeRowProps>(({ depth, expanded, node, onOpenFile, onToggleFolder }) => {
  const isOpen = expanded.has(node.path);
  const paddingInlineStart = TREE_BASE_INSET + depth * TREE_DEPTH_INDENT;

  if (node.isDirectory) {
    return (
      <>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.childItem}
          gap={6}
          style={{ paddingInlineStart }}
          onClick={() => onToggleFolder(node.path)}
        >
          <span className={styles.treeChevronSlot}>
            <Icon
              className={`${styles.chevron} ${isOpen ? styles.chevronExpanded : ''}`}
              icon={ChevronRightIcon}
              size={12}
            />
          </span>
          <Icon className={styles.childItemIcon} icon={FolderIcon} size={12} />
          <Text ellipsis style={{ flex: 1, fontSize: 12, minWidth: 0 }}>
            {node.name}
          </Text>
        </Flexbox>
        {isOpen &&
          node.children.map((child) => (
            <TreeRow
              depth={depth + 1}
              expanded={expanded}
              key={child.path}
              node={child}
              onOpenFile={onOpenFile}
              onToggleFolder={onToggleFolder}
            />
          ))}
      </>
    );
  }

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.childItem}
      gap={6}
      style={{ paddingInlineStart }}
      title={node.path}
      onClick={() => onOpenFile(node.path)}
    >
      <span className={styles.treeChevronSlot} />
      <Icon className={styles.childItemIcon} icon={FileIcon} size={12} />
      <Text ellipsis style={{ flex: 1, fontSize: 12, minWidth: 0 }}>
        {node.name}
      </Text>
    </Flexbox>
  );
});

TreeRow.displayName = 'SkillsListTreeRow';

interface SkillRowProps {
  expanded: boolean;
  item: SkillListItem;
  onOpenFile?: (relativePath: string) => void;
  onOpenSkill?: () => void;
  onToggle: () => void;
}

const SkillRow = memo<SkillRowProps>(({ expanded, item, onOpenFile, onOpenSkill, onToggle }) => {
  const tree = useMemo(() => buildSkillTree(item.files), [item.files]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());

  const toggleFolder = useCallback((folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  }, []);

  return (
    <>
      <Tooltip
        placement={'left'}
        title={
          item.description ? (
            <span className={styles.description}>{item.description}</span>
          ) : undefined
        }
      >
        <Flexbox horizontal align={'center'} className={styles.item} gap={6}>
          <Flexbox
            align={'center'}
            justify={'center'}
            style={{ cursor: 'pointer', flexShrink: 0, height: 20, width: 20 }}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            <Icon
              className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ''}`}
              icon={ChevronRightIcon}
              size={14}
            />
          </Flexbox>
          <Icon className={styles.itemIcon} icon={SkillsIcon} size={14} />
          <Text ellipsis style={{ flex: 1, minWidth: 0 }} onClick={onOpenSkill}>
            {item.name}
          </Text>
          <span className={styles.itemCount}>{item.fileCount}</span>
        </Flexbox>
      </Tooltip>
      {expanded &&
        onOpenFile &&
        tree.map((node) => (
          <TreeRow
            depth={0}
            expanded={expandedFolders}
            key={node.path}
            node={node}
            onOpenFile={onOpenFile}
            onToggleFolder={toggleFolder}
          />
        ))}
    </>
  );
});

SkillRow.displayName = 'SkillsListSkillRow';

const SkillsList = memo<SkillsListProps>(({ items, onOpenFile, onOpenSkill }) => {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <Flexbox gap={2}>
      {items.map((item) => (
        <SkillRow
          expanded={expanded.has(item.id)}
          item={item}
          key={item.id}
          onOpenFile={onOpenFile ? (relativePath) => onOpenFile(item, relativePath) : undefined}
          onOpenSkill={onOpenSkill ? () => onOpenSkill(item) : undefined}
          onToggle={() => toggle(item.id)}
        />
      ))}
    </Flexbox>
  );
});

SkillsList.displayName = 'SkillsList';

export default SkillsList;
