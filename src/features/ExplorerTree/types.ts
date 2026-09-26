import type { FileTreeRowDecoration, GitStatusEntry } from '@pierre/trees';
import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';

import type { NativeContextMenuItem } from '@/libs/contextMenu/types';

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
  sourceIds: string[];
  sourceNodes: ExplorerTreeNode<TData>[];
  targetId: string | null;
  targetNode: ExplorerTreeNode<TData> | null;
}

export interface ExplorerTreeCanDropCtx<TData = unknown> {
  sourceIds: string[];
  sourceNodes: ExplorerTreeNode<TData>[];
  targetId: string | null;
  targetNode: ExplorerTreeNode<TData> | null;
}

export interface ExplorerTreeRowDecorationCtx<TData = unknown> {
  node: ExplorerTreeNode<TData>;
}

export type ExplorerTreeEntryKind = 'file' | 'folder';

/** What `validateName` is asked to check while an inline name input is open. */
export type ExplorerTreeNameCheck<TData = unknown> =
  | {
      kind: ExplorerTreeEntryKind;
      mode: 'create';
      name: string;
      /** `null` when the new entry lands at the top level of the tree. */
      parentNode: ExplorerTreeNode<TData> | null;
    }
  | { mode: 'rename'; name: string; node: ExplorerTreeNode<TData> };

export interface ExplorerTreeCreateEvent<TData = unknown> {
  kind: ExplorerTreeEntryKind;
  name: string;
  parentNode: ExplorerTreeNode<TData> | null;
}

export interface ExplorerTreeKeyDownCtx<TData = unknown> {
  focusedNode: ExplorerTreeNode<TData> | null;
  selectedNodes: ExplorerTreeNode<TData>[];
}

export interface ExplorerTreeHandle {
  deselect: (id: string) => void;
  focus: (id: string) => void;
  getFocusedId: () => string | null;
  getSelectedIds: () => string[];
  /**
   * Re-applies the current `nodes` to the tree model, dropping any optimistic
   * rename / move / create the tree applied on its own.
   */
  resync: () => void;
  select: (id: string, opts?: { additive?: boolean }) => void;
  setExpanded: (ids: string[]) => void;
  /**
   * Inserts a placeholder row under `parentId` (`null` = top level) and opens
   * the inline name input on it. Committing calls `onCommitCreate`; an empty
   * name or Escape removes the placeholder.
   */
  startCreating: (parentId: string | null, kind: ExplorerTreeEntryKind) => void;
  startRenaming: (id: string) => void;
}

export interface ExplorerTreeProps<TData = unknown> {
  canDrag?: (node: ExplorerTreeNode<TData>) => boolean;
  canDrop?: (ctx: ExplorerTreeCanDropCtx<TData>) => boolean;
  canRename?: (node: ExplorerTreeNode<TData>) => boolean;
  className?: string;
  /** @deprecated Use defaultExpandedIds instead. */
  defaultExpanded?: string[];
  defaultExpandedIds?: string[];
  /** @deprecated Use defaultSelectedIds instead. */
  defaultSelected?: string[];
  defaultSelectedIds?: string[];
  density?: 'compact' | 'default' | 'relaxed' | number;
  expandedIds?: string[];
  /** Menu for a right click that lands on no row (the blank area under the rows). */
  getBlankContextMenuItems?: () => NativeContextMenuItem[];
  getContextMenuItems?: (node: ExplorerTreeNode<TData>) => NativeContextMenuItem[];
  getRowDecoration?: (
    ctx: ExplorerTreeRowDecorationCtx<TData>,
  ) => FileTreeRowDecoration | null | undefined;
  gitStatus?: readonly GitStatusEntry[];
  header?: ReactNode;
  iconsColored?: boolean;
  iconSet?: 'minimal' | 'standard' | 'complete' | 'none';
  itemHeight?: number;
  nodes: ExplorerTreeNode<TData>[];
  /** Resolve `false` when creation failed so the optimistic row is dropped. */
  onCommitCreate?: (
    event: ExplorerTreeCreateEvent<TData>,
  ) => boolean | void | Promise<boolean | void>;
  /** Resolve `false` when the rename failed so the tree rolls the row back. */
  onCommitRename?: (
    node: ExplorerTreeNode<TData>,
    newName: string,
  ) => boolean | void | Promise<boolean | void>;
  onExpandedChange?: (ids: string[]) => void;
  onExternalDrop?: (event: {
    nativeEvent: DragEvent<HTMLElement>;
    targetId: string | null;
    targetNode: ExplorerTreeNode<TData> | null;
  }) => void;
  /** Resolve `false` when the move failed so the tree rolls the drop back. */
  onMove?: (event: ExplorerTreeMoveEvent<TData>) => boolean | void | Promise<boolean | void>;
  onNodeClick?: (node: ExplorerTreeNode<TData>, event: MouseEvent<HTMLElement>) => void;
  onNodeDragStart?: (node: ExplorerTreeNode<TData>, event: DragEvent<HTMLElement>) => void;
  onRenameError?: (error: unknown, node: ExplorerTreeNode<TData>) => void;
  onSelectedChange?: (ids: string[]) => void;
  /**
   * Keys pressed on a tree row (never inside the rename or search input).
   * Return `true` when handled; the event is then stopped so it can't reach
   * page-level shortcuts.
   */
  onTreeKeyDown?: (
    event: KeyboardEvent<HTMLElement>,
    ctx: ExplorerTreeKeyDownCtx<TData>,
  ) => boolean | void;
  overscan?: number;
  selectedIds?: string[];
  style?: CSSProperties;
  /** Raw CSS injected into the pierre/trees shadow DOM via FILE_TREE_UNSAFE_CSS_ATTRIBUTE. */
  unsafeCSS?: string;
  /**
   * Checks a name typed into the inline input. Return a message to show it
   * under the input and block the commit (Enter or blur); the input stays open
   * with the user's text.
   */
  validateName?: (check: ExplorerTreeNameCheck<TData>) => string | null | undefined;
}
