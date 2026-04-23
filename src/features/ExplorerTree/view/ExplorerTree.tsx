'use client';

import type {
  FileTreeDirectoryHandle,
  FileTreeItemHandle,
  FileTreeOptions,
  FileTreeRowDecoration,
} from '@pierre/trees';
import { FileTree as PierreFileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react';
import {
  type ForwardedRef,
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';

import {
  arrayEqual,
  type NormalizedTree,
  normalizeTree,
  remapIdsToPaths,
  remapPathsToIds,
} from '../adapter';
import { extractName } from '../adapter/path';
import type {
  ExplorerTreeHandle,
  ExplorerTreeMoveEvent,
  ExplorerTreeNode,
  ExplorerTreeProps,
} from '../types';
import { renderContextMenuSurface } from './ContextMenu';

const asDirectory = (
  handle: FileTreeItemHandle | null | undefined,
): FileTreeDirectoryHandle | null =>
  handle && handle.isDirectory() ? (handle as FileTreeDirectoryHandle) : null;

function ExplorerTreeInner<TData>(
  props: ExplorerTreeProps<TData>,
  ref: ForwardedRef<ExplorerTreeHandle>,
) {
  const propsRef = useRef(props);
  propsRef.current = props;

  const adapterRef = useRef<NormalizedTree<TData>>(normalizeTree(props.nodes));

  // emitted values so we don't fire feedback loops on change listeners
  const lastEmittedSelectedIds = useRef<string[]>(props.defaultSelected ?? []);
  const renamingRef = useRef(false);

  const initialOptions = useMemo((): FileTreeOptions => {
    const initial = adapterRef.current;
    const initialExpandedPaths = remapIdsToPaths(props.defaultExpanded, initial.pathById);
    const initialSelectedPaths = remapIdsToPaths(props.defaultSelected, initial.pathById);

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
          const target = toNodeOrNull(event.target.directoryPath);
          const [firstSource] = event.draggedPaths;
          const source = toNodeOrNull(firstSource ?? null);
          if (!source) return false;
          return fn({ source, target });
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
            position: 'inside',
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
        const ids = remapPathsToIds(paths, adapterRef.current.idByPath);
        if (arrayEqual(ids, lastEmittedSelectedIds.current)) return;
        lastEmittedSelectedIds.current = ids;
        propsRef.current.onSelectedChange?.(ids);
      },
      overscan: props.overscan,
      paths: initial.paths,
      renaming: {
        canRename: (item) => {
          const node = adapterRef.current.nodeById.get(
            adapterRef.current.idByPath.get(item.path) ?? '',
          );
          if (!node) return false;
          const fn = propsRef.current.canRename;
          return fn ? fn(node) : !!propsRef.current.onCommitRename;
        },
        onError: (error) => {
          const node = renamingNodeRef.current;
          if (node) propsRef.current.onRenameError?.(error, node);
        },
        onRename: ({ sourcePath, destinationPath }) => {
          const a = adapterRef.current;
          const id = a.idByPath.get(sourcePath);
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

  // nodes prop changes → resetPaths
  useLayoutEffect(() => {
    const next = normalizeTree(propsRef.current.nodes);
    const prev = adapterRef.current;
    if (arrayEqual(next.paths, prev.paths)) {
      adapterRef.current = next; // keep metadata fresh (name/data) even if paths identical
      return;
    }
    if (renamingRef.current) return; // defer reset while a rename is pending
    const currentExpandedIds: string[] = [];
    for (const [id, path] of prev.pathById) {
      const dir = asDirectory(model.getItem(path));
      if (dir?.isExpanded()) currentExpandedIds.push(id);
    }
    const currentSelectedIds = remapPathsToIds(model.getSelectedPaths(), prev.idByPath);
    const focusedPath = model.getFocusedPath();
    const focusedId = focusedPath ? prev.idByPath.get(focusedPath) : null;

    adapterRef.current = next;
    model.resetPaths(next.paths, {
      initialExpandedPaths: remapIdsToPaths(currentExpandedIds, next.pathById),
    });
    // restore selection
    for (const id of currentSelectedIds) {
      const path = next.pathById.get(id);
      if (!path) continue;
      model.getItem(path)?.select();
    }
    // restore focus
    if (focusedId) {
      const path = next.pathById.get(focusedId);
      if (path) model.focusPath(path);
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

  const renderContextMenu = useMemo(() => {
    return (
      item: { path: string },
      ctx: { close: (opts?: { restoreFocus?: boolean }) => void },
    ) => {
      const fn = propsRef.current.getContextMenuItems;
      if (!fn) return null;
      const a = adapterRef.current;
      const id = a.idByPath.get(item.path);
      if (!id) return null;
      const node = a.nodeById.get(id);
      if (!node) return null;
      const items = fn(node);
      if (!items || items.length === 0) return null;
      return renderContextMenuSurface(items, () => ctx.close({ restoreFocus: false }));
    };
  }, []);

  return (
    <PierreFileTree
      className={props.className}
      header={props.header}
      model={model}
      renderContextMenu={renderContextMenu as never}
      style={props.style}
    />
  );
}

const ExplorerTree = forwardRef(ExplorerTreeInner) as <TData>(
  props: ExplorerTreeProps<TData> & { ref?: ForwardedRef<ExplorerTreeHandle> },
) => ReturnType<typeof ExplorerTreeInner>;

export default ExplorerTree;
