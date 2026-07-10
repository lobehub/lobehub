import { EMPTY_ARRAY } from '@lobechat/const';
import {
  ContextMenuTrigger,
  Flexbox,
  type GenericItemType,
  Icon,
  Text,
  Tooltip,
} from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronRightIcon, FileIcon, FolderIcon, type LucideIcon } from 'lucide-react';
import type React from 'react';
import { memo, useCallback, useMemo, useState } from 'react';

export interface SkillListItem {
  description?: string;
  /**
   * File count shown next to the name. Omit (or pass 0) for atomic skills with
   * no embedded files — e.g. user-level skills sourced from MCP servers.
   */
  fileCount?: number;
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

/**
 * A per-row action (view / rename / delete …). The same descriptor drives both
 * the hover-revealed icon button on the right of the row and the right-click
 * context menu, so callers wire each capability once. Disabled actions render
 * greyed (used for not-yet-supported operations, e.g. mutating filesystem
 * project skills).
 */
export interface SkillRowAction {
  danger?: boolean;
  disabled?: boolean;
  icon: LucideIcon;
  key: string;
  label: string;
  onClick: (item: SkillListItem) => void;
  /** Hover-icon tooltip; falls back to `label`. Use for "coming soon" hints. */
  tooltip?: string;
}

interface SkillsListProps {
  /**
   * Per-row actions. When this returns a non-empty array the row gains a
   * hover-revealed action cluster (right side, swaps with the file count) and a
   * right-click context menu sharing the same actions. Return `[]`/omit for
   * read-only rows (no menu, native right-click preserved).
   */
  getRowActions?: (item: SkillListItem) => SkillRowAction[];
  items: SkillListItem[];
  onOpenFile?: (item: SkillListItem, relativePath: string) => void;
  onOpenSkill?: (item: SkillListItem) => void;
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

    /* Swap the file count for the row actions while hovering the row. */
    &:hover .skill-row-actions {
      display: flex;
    }

    &:hover .skill-row-count {
      display: none;
    }
  `,
  itemCount: css`
    flex-shrink: 0;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  rowAction: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    border-radius: 4px;

    color: ${cssVar.colorTextTertiary};

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  rowActionDanger: css`
    &:hover {
      color: ${cssVar.colorError};
      background: ${cssVar.colorErrorBg};
    }
  `,
  rowActionDisabled: css`
    cursor: not-allowed;
    color: ${cssVar.colorTextQuaternary};

    &:hover {
      color: ${cssVar.colorTextQuaternary};
      background: transparent;
    }
  `,
  rowActions: css`
    display: none;
    flex: none;
    gap: 2px;
    align-items: center;
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
  actions: SkillRowAction[];
  expanded: boolean;
  item: SkillListItem;
  onDragStart?: (event: React.DragEvent) => void;
  onOpenFile?: (relativePath: string) => void;
  onOpenSkill?: () => void;
  onToggle: () => void;
  reserveChevronSlot: boolean;
}

const SkillRow = memo<SkillRowProps>(
  ({
    actions,
    expanded,
    item,
    onDragStart,
    onOpenFile,
    onOpenSkill,
    onToggle,
    reserveChevronSlot,
  }) => {
    const files = item.files ?? EMPTY_ARRAY;
    const hasFiles = files.length > 0;
    const hasActions = actions.length > 0;
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

    const contextMenuItems = useCallback(
      (): GenericItemType[] =>
        actions.map((action) => ({
          danger: action.danger,
          disabled: action.disabled,
          icon: <Icon icon={action.icon} />,
          key: action.key,
          label: action.label,
          onClick: () => action.onClick(item),
        })),
      [actions, item],
    );

    // The description Tooltip wraps just the name (a ref-forwarding leaf) and the
    // ContextMenuTrigger wraps just the row Flexbox — both cloning wrappers get
    // a clean DOM-forwarding child. Nesting them (Tooltip around the trigger, or
    // vice versa) would drop `onContextMenu` / the ref on the way through.
    const nameNode = (
      <Text ellipsis style={{ color: 'inherit', flex: 1, minWidth: 0 }} onClick={onOpenSkill}>
        {item.name}
      </Text>
    );

    const row = (
      <Flexbox
        horizontal
        align={'center'}
        className={styles.item}
        draggable={!!onDragStart}
        gap={6}
        onDragStart={onDragStart}
      >
        {hasFiles ? (
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
        ) : reserveChevronSlot ? (
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
        {typeof item.fileCount === 'number' && item.fileCount > 0 && (
          <span className={cx('skill-row-count', styles.itemCount)}>{item.fileCount}</span>
        )}
        {hasActions && (
          <div className={cx('skill-row-actions', styles.rowActions)} draggable={false}>
            {actions.map((action) => (
              <Tooltip key={action.key} title={action.tooltip ?? action.label}>
                <div
                  role={'button'}
                  className={cx(
                    styles.rowAction,
                    action.danger && !action.disabled && styles.rowActionDanger,
                    action.disabled && styles.rowActionDisabled,
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (action.disabled) return;
                    action.onClick(item);
                  }}
                >
                  <Icon icon={action.icon} size={13} />
                </div>
              </Tooltip>
            ))}
          </div>
        )}
      </Flexbox>
    );

    return (
      <>
        {hasActions ? <ContextMenuTrigger items={contextMenuItems}>{row}</ContextMenuTrigger> : row}
        {expanded &&
          hasFiles &&
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
  },
);

SkillRow.displayName = 'SkillsListSkillRow';

const SkillsList = memo<SkillsListProps>(
  ({ getRowActions, items, onOpenFile, onOpenSkill, onSkillDragStart }) => {
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
            actions={getRowActions?.(item) ?? EMPTY_ARRAY}
            expanded={expanded.has(item.id)}
            item={item}
            key={item.id}
            reserveChevronSlot={reserveChevronSlot}
            onDragStart={onSkillDragStart ? (event) => onSkillDragStart(item, event) : undefined}
            onOpenFile={onOpenFile ? (relativePath) => onOpenFile(item, relativePath) : undefined}
            onOpenSkill={onOpenSkill ? () => onOpenSkill(item) : undefined}
            onToggle={() => toggle(item.id)}
          />
        ))}
      </Flexbox>
    );
  },
);

SkillsList.displayName = 'SkillsList';

export default SkillsList;
