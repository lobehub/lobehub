import { EMPTY_ARRAY } from '@lobechat/const';
import { createStaticStyles, Flexbox, Icon, Tag, Text, Tooltip } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { ChevronRightIcon, FileIcon, FolderIcon } from 'lucide-react';
import type React from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface SkillListItem {
  description?: string;
  /** Manual invocation only, as declared by the skill; not a disabled state. */
  disableModelInvocation?: boolean;
  /**
   * Optional file tree for skills that bundle markdown/script assets. When
   * empty or omitted the row stays atomic (no chevron, no expansion).
   */
  files?: string[];
  id: string;
  name: string;
  /** Filesystem skill scope when the row comes from a device scan. */
  scope?: 'device' | 'project';
}

interface SkillsListProps {
  items: SkillListItem[];
  onOpenFile?: (item: SkillListItem, relativePath: string) => void;
  onOpenSkill?: (item: SkillListItem) => void;
  /** Select into the conversation instead of browsing the skill's files. */
  onSelectSkill?: (item: SkillListItem) => void;
  /**
   * When provided, each skill row becomes draggable and this fires on dragstart.
   * The handler is expected to write the drag payload onto `event.dataTransfer`
   * (see `writeSkillDragData`), letting the chat input resolve it on drop.
   */
  onSkillDragStart?: (item: SkillListItem, event: React.DragEvent) => void;
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
          <Text ellipsis style={{ color: 'inherit', flex: 1, fontSize: 12, minWidth: 0 }}>
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
      <Text ellipsis style={{ color: 'inherit', flex: 1, fontSize: 12, minWidth: 0 }}>
        {node.name}
      </Text>
    </Flexbox>
  );
});

TreeRow.displayName = 'SkillsListTreeRow';

interface SkillRowProps {
  expanded: boolean;
  item: SkillListItem;
  onOpenFile?: (item: SkillListItem, relativePath: string) => void;
  onOpenSkill?: (item: SkillListItem) => void;
  onSelectSkill?: (item: SkillListItem) => void;
  onSkillDragStart?: (item: SkillListItem, event: React.DragEvent) => void;
  onToggle: (id: string) => void;
  reserveChevronSlot: boolean;
}

// Rows receive the list-level handlers plus `item` (instead of pre-bound
// closures) so a parent re-render with unchanged data keeps every row's props
// referentially equal and the memo actually bails out.
const SkillRow = memo<SkillRowProps>(
  ({
    expanded,
    item,
    onOpenFile,
    onOpenSkill,
    onSelectSkill,
    onSkillDragStart,
    onToggle,
    reserveChevronSlot,
  }) => {
    const { t } = useTranslation('chat');
    const activateSkill = onSelectSkill ?? onOpenSkill;
    const files = onSelectSkill ? EMPTY_ARRAY : (item.files ?? EMPTY_ARRAY);
    const hasFiles = files.length > 0;
    const tree = useMemo(() => buildSkillTree(files), [files]);
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());

    const toggleFolder = useCallback((folderPath: string) => {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(folderPath)) next.delete(folderPath);
        else next.add(folderPath);
        return next;
      });
    }, []);

    const openFile = useCallback(
      (relativePath: string) => onOpenFile?.(item, relativePath),
      [item, onOpenFile],
    );

    const nameNode = (
      <Text ellipsis style={{ color: 'inherit', flex: 1, minWidth: 0 }}>
        {item.name}
      </Text>
    );

    const row = (
      <Flexbox
        horizontal
        align={'center'}
        className={styles.item}
        draggable={!!onSkillDragStart}
        gap={6}
        role={activateSkill ? 'button' : undefined}
        tabIndex={activateSkill ? 0 : undefined}
        onClick={activateSkill ? () => activateSkill(item) : undefined}
        onDragStart={onSkillDragStart ? (event) => onSkillDragStart(item, event) : undefined}
        onKeyDown={(event) => {
          if (!activateSkill || event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activateSkill(item);
          }
        }}
      >
        {hasFiles ? (
          <Flexbox
            align={'center'}
            justify={'center'}
            style={{ cursor: 'pointer', flexShrink: 0, height: 20, width: 20 }}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(item.id);
            }}
          >
            <Icon
              className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ''}`}
              icon={ChevronRightIcon}
              size={14}
            />
          </Flexbox>
        ) : !onSelectSkill && reserveChevronSlot ? (
          <span style={{ flexShrink: 0, height: 20, width: 20 }} />
        ) : null}
        <Icon className={styles.itemIcon} icon={SkillsIcon} size={14} />
        {item.description ? (
          <Tooltip
            placement={'left'}
            title={<span className={styles.description}>{item.description}</span>}
          >
            {nameNode}
          </Tooltip>
        ) : (
          nameNode
        )}
        {item.disableModelInvocation && (
          <Tag size={'small'} style={{ flexShrink: 0 }}>
            {t('workingPanel.skills.manualOnly')}
          </Tag>
        )}
      </Flexbox>
    );

    return (
      <>
        {row}
        {expanded &&
          hasFiles &&
          onOpenFile &&
          tree.map((node) => (
            <TreeRow
              depth={0}
              expanded={expandedFolders}
              key={node.path}
              node={node}
              onOpenFile={openFile}
              onToggleFolder={toggleFolder}
            />
          ))}
      </>
    );
  },
);

SkillRow.displayName = 'SkillsListSkillRow';

const SkillsList = memo<SkillsListProps>(
  ({ items, onOpenFile, onOpenSkill, onSelectSkill, onSkillDragStart }) => {
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

    const toggle = useCallback((id: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }, []);

    const reserveChevronSlot = useMemo(
      () => items.some((item) => (item.files?.length ?? 0) > 0),
      [items],
    );

    return (
      <Flexbox gap={2}>
        {items.map((item) => (
          <SkillRow
            expanded={expanded.has(item.id)}
            item={item}
            key={item.id}
            reserveChevronSlot={reserveChevronSlot}
            onOpenFile={onOpenFile}
            onOpenSkill={onOpenSkill}
            onSelectSkill={onSelectSkill}
            onSkillDragStart={onSkillDragStart}
            onToggle={toggle}
          />
        ))}
      </Flexbox>
    );
  },
);

SkillsList.displayName = 'SkillsList';

export default SkillsList;
