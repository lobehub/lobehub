import type { FileTreeRowDecoration } from '@pierre/trees';
import type { MenuProps } from 'antd';
import type { CSSProperties, ReactNode } from 'react';

export interface ExplorerTreeNode<TData = unknown> {
  children?: ExplorerTreeNode<TData>[];
  data?: TData;
  id: string;
  isFolder?: boolean;
  name: string;
  parentId?: string | null;
}

export interface ExplorerTreeMoveEvent<TData = unknown> {
  /** @deprecated Transitional compatibility for the current @pierre/trees bridge. */
  index?: number;
  newParentId: string | null;
  oldParentId: string | null;
  /** @deprecated Transitional compatibility for the current @pierre/trees bridge. */
  position?: 'inside';
  sourceIds: string[];
  sourceNodes: ExplorerTreeNode<TData>[];
  targetId: string | null;
  targetNode: ExplorerTreeNode<TData> | null;
}

export interface ExplorerTreeLegacyCanDropCtx<TData = unknown> {
  source: ExplorerTreeNode<TData>;
  target: ExplorerTreeNode<TData> | null;
}

export interface ExplorerTreeRowDecorationCtx<TData = unknown> {
  node: ExplorerTreeNode<TData>;
}

export interface ExplorerTreeHandle {
  deselect: (id: string) => void;
  focus: (id: string) => void;
  getSelectedIds: () => string[];
  select: (id: string, opts?: { additive?: boolean }) => void;
  setExpanded: (ids: string[]) => void;
  startRenaming: (id: string) => void;
}

export interface ExplorerTreeProps<TData = unknown> {
  canDrag?: (node: ExplorerTreeNode<TData>) => boolean;
  canDrop?: (ctx: ExplorerTreeLegacyCanDropCtx<TData>) => boolean;
  canRename?: (node: ExplorerTreeNode<TData>) => boolean;
  className?: string;
  defaultExpanded?: string[];
  defaultSelected?: string[];
  density?: 'compact' | 'default' | 'relaxed' | number;
  getContextMenuItems?: (node: ExplorerTreeNode<TData>) => MenuProps['items'];
  getRowDecoration?: (
    ctx: ExplorerTreeRowDecorationCtx<TData>,
  ) => FileTreeRowDecoration | null | undefined;
  header?: ReactNode;
  iconsColored?: boolean;
  iconSet?: 'minimal' | 'standard' | 'complete' | 'none';
  itemHeight?: number;
  nodes: ExplorerTreeNode<TData>[];
  onCommitRename?: (node: ExplorerTreeNode<TData>, newName: string) => void | Promise<void>;
  onExpandedChange?: (ids: string[]) => void;
  onMove?: (event: ExplorerTreeMoveEvent<TData>) => void | Promise<void>;
  onRenameError?: (error: unknown, node: ExplorerTreeNode<TData>) => void;
  onSelectedChange?: (ids: string[]) => void;
  overscan?: number;
  style?: CSSProperties;
}
