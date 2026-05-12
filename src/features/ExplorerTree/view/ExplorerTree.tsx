'use client';

import type {
  FileTreeDirectoryHandle,
  FileTreeItemHandle,
  FileTreeOptions,
  FileTreeRowDecoration,
} from '@pierre/trees';
import { FileTree as PierreFileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react';
import type { DragEvent, ForwardedRef, MouseEvent } from 'react';
import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';

import {
  arrayEqual,
  type NormalizedTree,
  normalizeTree,
  remapIdsToPaths,
  remapPathsToIds,
} from '../adapter';
import { extractName, toCanonicalTreePath } from '../adapter/path';
import type {
  ExplorerTreeHandle,
  ExplorerTreeMoveEvent,
  ExplorerTreeNode,
  ExplorerTreeProps,
} from '../types';
import { openExplorerContextMenu } from './ContextMenu';

const asDirectory = (
  handle: FileTreeItemHandle | null | undefined,
): FileTreeDirectoryHandle | null =>
  handle && handle.isDirectory() ? (handle as FileTreeDirectoryHandle) : null;

type ExplorerTreeHostEvent = DragEvent<HTMLElement> | MouseEvent<HTMLElement>;

const isHTMLElement = (target: EventTarget): target is HTMLElement => target instanceof HTMLElement;

const getComposedPath = (event: ExplorerTreeHostEvent): EventTarget[] => {
  const path = event.nativeEvent.composedPath();
  if (path.length > 0) return path;

  return [event.target, event.currentTarget].filter(
    (target): target is EventTarget => target != null,
  );
};

export const getItemPathFromEventPath = (path: EventTarget[]): string | null => {
  for (const target of path) {
    if (!isHTMLElement(target)) continue;
    const flattenedSegmentPath = target.getAttribute('data-item-flattened-subitem');
    if (flattenedSegmentPath) return flattenedSegmentPath;
    if (target.dataset.type !== 'item') continue;
    const path = target.dataset.itemPath;
    if (path) return path;
  }

  return null;
};

const getItemPathFromHostEvent = (event: ExplorerTreeHostEvent): string | null =>
  getItemPathFromEventPath(getComposedPath(event));

function ExplorerTreeInner<TData>(
  props: ExplorerTreeProps<TData>,
  ref: ForwardedRef<ExplorerTreeHandle>,
) {
  const propsRef = useRef(props);
  propsRef.current = props;

  const adapterRef = useRef<NormalizedTree<TData>>(normalizeTree(props.nodes));

  // emitted values so we don't fire feedback loops on change listeners
  const lastEmittedSelectedIds = useRef<string[]>(
    props.defaultSelectedIds ?? props.defaultSelected ?? [],
  );
  const suppressModelEventsRef = useRef(false);
  const renamingRef = useRef(false);

  const initialOptions = useMemo((): FileTreeOptions => {
    const initial = adapterRef.current;
    const initialExpandedPaths = remapIdsToPaths(
      props.defaultExpandedIds ?? props.defaultExpanded,
      initial.pathById,
    );
    const initialSelectedPaths = remapIdsToPaths(
      props.defaultSelectedIds ?? props.defaultSelected,
      initial.pathById,
    );

    const toNodeOrNull = (path: string | null) =>
      path == null
        ? null
        : (adapterRef.current.nodeById.get(adapterRef.current.idByPath.get(path) ?? '') ?? null);

    return {
      density: props.density,
      dragAndDrop: {
        canDrag: (paths) => {
          const fn = propsRef.current.canDrag;
          if (!fn) return true;
          for (const p of paths) {
            const node = toNodeOrNull(p);
            if (!node || !fn(node)) return false;
          }
          return true;
        },
        canDrop: (event) => {
          const fn = propsRef.current.canDrop;
          if (!fn) return true;
          const a = adapterRef.current;
          const sourceIds = remapPathsToIds(event.draggedPaths, a.idByPath);
          const sourceNodes = sourceIds
            .map((id) => a.nodeById.get(id))
            .filter((n): n is ExplorerTreeNode<TData> => !!n);
          if (
            sourceIds.length !== event.draggedPaths.length ||
            sourceNodes.length !== sourceIds.length
          ) {
            return false;
          }
          // Use directoryPath (= the new parent), not hoveredPath. Hovering a
          // file row at root yields directoryPath=null (root) but hoveredPath
          // points at the file itself; conflating them blocks legitimate drops
          // because canDrop sees a file as the target zone.
          const newParentPath = event.target.directoryPath;
          const targetId = newParentPath ? (a.idByPath.get(newParentPath) ?? null) : null;
          return fn({
            sourceIds,
            sourceNodes,
            targetId,
            targetNode: targetId ? (a.nodeById.get(targetId) ?? null) : null,
          });
        },
        onDropComplete: (event) => {
          const onMove = propsRef.current.onMove;
          if (!onMove) return;
          const a = adapterRef.current;
          const sourceIds = remapPathsToIds(event.draggedPaths, a.idByPath);
          const sourceNodes = sourceIds
            .map((id) => a.nodeById.get(id))
            .filter((n): n is ExplorerTreeNode<TData> => !!n);
          const targetPath = event.target.hoveredPath ?? event.target.directoryPath;
          const targetId = targetPath ? (a.idByPath.get(targetPath) ?? null) : null;
          const newParentPath = event.target.directoryPath;
          const newParentId = newParentPath ? (a.idByPath.get(newParentPath) ?? null) : null;
          const parents = new Set(sourceIds.map((id) => a.parentIdById.get(id) ?? null));
          const oldParentId = parents.size === 1 ? [...parents][0] : null;
          const moveEvent: ExplorerTreeMoveEvent<TData> = {
            newParentId,
            oldParentId,
            sourceIds,
            sourceNodes,
            targetId,
            targetNode: targetId ? (a.nodeById.get(targetId) ?? null) : null,
          };
          void onMove(moveEvent);
        },
      },
      icons: {
        colored: props.iconsColored ?? true,
        set: props.iconSet ?? 'standard',
      },
      initialExpandedPaths,
      initialSelectedPaths,
      itemHeight: props.itemHeight,
      onSelectionChange: (paths) => {
        if (suppressModelEventsRef.current) return;
        const ids = remapPathsToIds(paths, adapterRef.current.idByPath);
        if (arrayEqual(ids, lastEmittedSelectedIds.current)) return;
        lastEmittedSelectedIds.current = ids;
        propsRef.current.onSelectedChange?.(ids);
      },
      overscan: props.overscan,
      paths: initial.paths,
      renaming: {
        canRename: (item) => {
          const path = toCanonicalTreePath(item.path, item.isFolder);
          const node = adapterRef.current.nodeById.get(adapterRef.current.idByPath.get(path) ?? '');
          if (!node) return false;
          const fn = propsRef.current.canRename;
          return fn ? fn(node) : !!propsRef.current.onCommitRename;
        },
        onError: (error) => {
          const node = renamingNodeRef.current;
          if (node) propsRef.current.onRenameError?.(error, node);
        },
        onRename: ({ sourcePath, destinationPath, isFolder }) => {
          const a = adapterRef.current;
          const id = a.idByPath.get(toCanonicalTreePath(sourcePath, isFolder));
          if (!id) return;
          const node = a.nodeById.get(id);
          if (!node) return;
          renamingNodeRef.current = node;
          const newName = extractName(destinationPath);
          const result = propsRef.current.onCommitRename?.(node, newName);
          if (result && typeof (result as Promise<void>).then === 'function') {
            (result as Promise<void>).finally(() => {
              renamingNodeRef.current = null;
              renamingRef.current = false;
            });
          } else {
            renamingNodeRef.current = null;
            renamingRef.current = false;
          }
        },
      },
      renderRowDecoration: (ctx) => {
        const fn = propsRef.current.getRowDecoration;
        if (!fn) return null;
        const a = adapterRef.current;
        const id = a.idByPath.get(ctx.item.path);
        if (!id) return null;
        const node = a.nodeById.get(id);
        if (!node) return null;
        return (fn({ node }) as FileTreeRowDecoration | null) ?? null;
      },
    };
    // we build options ONCE; callbacks read propsRef to stay fresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renamingNodeRef = useRef<ExplorerTreeNode<TData> | null>(null);
  const { model } = useFileTree(initialOptions);

  // Observe selection changes so external consumers see updates without needing to pass a selection listener.
  useFileTreeSelection(model);

  // Track expansion by subscribing to mutation events (expansion isn't a mutation — use subscribe).
  // We read expanded paths on demand from the visible rows via getItem; emit when defaultExpanded or nodes changes.
  useLayoutEffect(() => {
    return model.subscribe(() => {
      if (suppressModelEventsRef.current) return;
      const onChange = propsRef.current.onExpandedChange;
      if (!onChange) return;
      const a = adapterRef.current;
      const nextExpanded: string[] = [];
      for (const [id, path] of a.pathById) {
        const dir = asDirectory(model.getItem(path));
        if (dir?.isExpanded()) nextExpanded.push(id);
      }
      // Fire only when set differs; cheap comparison via sorted join
      const signature = nextExpanded.slice().sort().join('\n');
      if (signature === lastExpandedSignatureRef.current) return;
      lastExpandedSignatureRef.current = signature;
      onChange(nextExpanded);
    });
  }, [model]);

  const lastExpandedSignatureRef = useRef<string>('');

  useLayoutEffect(() => {
    const selectedIds = props.selectedIds;
    if (!selectedIds) return;
    const a = adapterRef.current;
    const nextSelectedPaths = remapIdsToPaths(selectedIds, a.pathById);
    const nextSelectedIds = remapPathsToIds(nextSelectedPaths, a.idByPath);
    const currentSelectedPaths = model.getSelectedPaths();
    const currentSelectedIds = remapPathsToIds(currentSelectedPaths, a.idByPath);
    lastEmittedSelectedIds.current = nextSelectedIds;
    if (arrayEqual(currentSelectedIds, nextSelectedIds)) return;

    const nextSelectedPathSet = new Set(nextSelectedPaths);
    suppressModelEventsRef.current = true;
    try {
      for (const path of currentSelectedPaths) {
        if (!nextSelectedPathSet.has(path)) model.getItem(path)?.deselect();
      }
      const currentSelectedPathSet = new Set(currentSelectedPaths);
      for (const path of nextSelectedPaths) {
        if (!currentSelectedPathSet.has(path)) model.getItem(path)?.select();
      }
    } finally {
      suppressModelEventsRef.current = false;
    }
  }, [props.selectedIds, model]);

  useLayoutEffect(() => {
    const expandedIds = props.expandedIds;
    if (!expandedIds) return;
    const a = adapterRef.current;
    const nextExpandedIdSet = new Set(expandedIds);
    const nextExpandedIds: string[] = [];
    const directoryEntries: { dir: FileTreeDirectoryHandle; shouldExpand: boolean }[] = [];
    for (const [id, path] of a.pathById) {
      const dir = asDirectory(model.getItem(path));
      if (!dir) continue;
      const shouldExpand = nextExpandedIdSet.has(id);
      if (shouldExpand) nextExpandedIds.push(id);
      directoryEntries.push({ dir, shouldExpand });
    }
    lastExpandedSignatureRef.current = nextExpandedIds.slice().sort().join('\n');
    suppressModelEventsRef.current = true;
    try {
      for (const { dir, shouldExpand } of directoryEntries) {
        if (shouldExpand && !dir.isExpanded()) dir.expand();
        else if (!shouldExpand && dir.isExpanded()) dir.collapse();
      }
    } finally {
      suppressModelEventsRef.current = false;
    }
  }, [props.expandedIds, model]);

  // nodes prop changes → resetPaths
  useLayoutEffect(() => {
    const next = normalizeTree(propsRef.current.nodes);
    const prev = adapterRef.current;
    if (arrayEqual(next.paths, prev.paths)) {
      adapterRef.current = next; // keep metadata fresh (name/data) even if paths identical
      const selectedIds = propsRef.current.selectedIds;
      if (selectedIds) {
        const nextSelectedPaths = remapIdsToPaths(selectedIds, next.pathById);
        const nextSelectedIds = remapPathsToIds(nextSelectedPaths, next.idByPath);
        const currentSelectedPaths = model.getSelectedPaths();
        const currentSelectedIds = remapPathsToIds(currentSelectedPaths, next.idByPath);
        lastEmittedSelectedIds.current = nextSelectedIds;
        if (!arrayEqual(currentSelectedIds, nextSelectedIds)) {
          const nextSelectedPathSet = new Set(nextSelectedPaths);
          suppressModelEventsRef.current = true;
          try {
            for (const path of currentSelectedPaths) {
              if (!nextSelectedPathSet.has(path)) model.getItem(path)?.deselect();
            }
            const currentSelectedPathSet = new Set(currentSelectedPaths);
            for (const path of nextSelectedPaths) {
              if (!currentSelectedPathSet.has(path)) model.getItem(path)?.select();
            }
          } finally {
            suppressModelEventsRef.current = false;
          }
        }
      }

      const expandedIds = propsRef.current.expandedIds;
      if (expandedIds) {
        const nextExpandedIdSet = new Set(expandedIds);
        const nextExpandedIds: string[] = [];
        const directoryEntries: { dir: FileTreeDirectoryHandle; shouldExpand: boolean }[] = [];
        for (const [id, path] of next.pathById) {
          const dir = asDirectory(model.getItem(path));
          if (!dir) continue;
          const shouldExpand = nextExpandedIdSet.has(id);
          if (shouldExpand) nextExpandedIds.push(id);
          directoryEntries.push({ dir, shouldExpand });
        }
        lastExpandedSignatureRef.current = nextExpandedIds.slice().sort().join('\n');
        suppressModelEventsRef.current = true;
        try {
          for (const { dir, shouldExpand } of directoryEntries) {
            if (shouldExpand && !dir.isExpanded()) dir.expand();
            else if (!shouldExpand && dir.isExpanded()) dir.collapse();
          }
        } finally {
          suppressModelEventsRef.current = false;
        }
      }
      return;
    }
    let nextExpandedIds = propsRef.current.expandedIds;
    if (!nextExpandedIds) {
      nextExpandedIds = [];
      for (const [id, path] of prev.pathById) {
        const dir = asDirectory(model.getItem(path));
        if (dir?.isExpanded()) nextExpandedIds.push(id);
      }
    }
    const nextSelectedIds =
      propsRef.current.selectedIds ?? remapPathsToIds(model.getSelectedPaths(), prev.idByPath);
    const focusedPath = model.getFocusedPath();
    const focusedId = focusedPath ? prev.idByPath.get(focusedPath) : null;

    adapterRef.current = next;
    const initialExpandedPaths = remapIdsToPaths(nextExpandedIds, next.pathById);
    lastExpandedSignatureRef.current = remapPathsToIds(initialExpandedPaths, next.idByPath)
      .slice()
      .sort()
      .join('\n');
    // restore selection
    const nextSelectedPaths = remapIdsToPaths(nextSelectedIds, next.pathById);
    lastEmittedSelectedIds.current = remapPathsToIds(nextSelectedPaths, next.idByPath);
    suppressModelEventsRef.current = true;
    try {
      model.resetPaths(next.paths, {
        initialExpandedPaths,
      });
      for (const path of nextSelectedPaths) {
        model.getItem(path)?.select();
      }
      if (focusedId) {
        const path = next.pathById.get(focusedId);
        if (path) model.focusPath(path);
      }
    } finally {
      suppressModelEventsRef.current = false;
    }
  }, [props.nodes, model]);

  useImperativeHandle(
    ref,
    (): ExplorerTreeHandle => ({
      deselect: (id) => {
        const path = adapterRef.current.pathById.get(id);
        if (!path) return;
        model.getItem(path)?.deselect();
      },
      focus: (id) => {
        const path = adapterRef.current.pathById.get(id);
        if (path) model.focusPath(path);
      },
      getSelectedIds: () => remapPathsToIds(model.getSelectedPaths(), adapterRef.current.idByPath),
      select: (id, opts) => {
        const path = adapterRef.current.pathById.get(id);
        if (!path) return;
        const item = model.getItem(path);
        if (!item) return;
        if (opts?.additive) item.toggleSelect();
        else item.select();
      },
      setExpanded: (ids) => {
        const want = new Set(ids);
        const a = adapterRef.current;
        for (const [nodeId, path] of a.pathById) {
          const dir = asDirectory(model.getItem(path));
          if (!dir) continue;
          const shouldExpand = want.has(nodeId);
          if (shouldExpand && !dir.isExpanded()) dir.expand();
          else if (!shouldExpand && dir.isExpanded()) dir.collapse();
        }
      },
      startRenaming: (id) => {
        const path = adapterRef.current.pathById.get(id);
        if (!path) return;
        renamingRef.current = true;
        model.startRenaming(path);
      },
    }),
    [model],
  );

  const handleContextMenu = (event: MouseEvent<HTMLElement>) => {
    const fn = propsRef.current.getContextMenuItems;
    if (!fn) return;
    const itemPath = getItemPathFromHostEvent(event);
    if (!itemPath) return;
    const a = adapterRef.current;
    const id = a.idByPath.get(itemPath);
    if (!id) return;
    const node = a.nodeById.get(id);
    if (!node) return;
    const items = fn(node);
    if (!items || items.length === 0) return;
    event.preventDefault();
    openExplorerContextMenu(items);
  };

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    const onNodeClick = propsRef.current.onNodeClick;
    if (!onNodeClick) return;
    const itemPath = getItemPathFromHostEvent(event);
    if (!itemPath) return;
    const a = adapterRef.current;
    const id = a.idByPath.get(itemPath);
    if (!id) return;
    const node = a.nodeById.get(id);
    if (!node) return;
    onNodeClick(node, event);
  };

  const handleDropCapture = (event: DragEvent<HTMLElement>) => {
    const onExternalDrop = propsRef.current.onExternalDrop;
    if (!onExternalDrop) return;
    const itemPath = getItemPathFromHostEvent(event);
    if (!itemPath) return;
    const a = adapterRef.current;
    const targetId = a.idByPath.get(itemPath) ?? null;
    const targetNode = targetId ? (a.nodeById.get(targetId) ?? null) : null;
    onExternalDrop({
      nativeEvent: event,
      targetId,
      targetNode,
    });
  };

  const handleDragStart = (event: DragEvent<HTMLElement>) => {
    const onNodeDragStart = propsRef.current.onNodeDragStart;
    if (!onNodeDragStart) return;
    const itemPath = getItemPathFromHostEvent(event);
    if (!itemPath) return;
    const a = adapterRef.current;
    const id = a.idByPath.get(itemPath);
    if (!id) return;
    const node = a.nodeById.get(id);
    if (!node) return;
    onNodeDragStart(node, event);
  };

  return (
    <PierreFileTree
      className={props.className}
      header={props.header}
      model={model}
      style={props.style}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onDragStart={handleDragStart}
      onDropCapture={handleDropCapture}
    />
  );
}

const ExplorerTree = forwardRef(ExplorerTreeInner) as <TData>(
  props: ExplorerTreeProps<TData> & { ref?: ForwardedRef<ExplorerTreeHandle> },
) => ReturnType<typeof ExplorerTreeInner>;

export default ExplorerTree;
