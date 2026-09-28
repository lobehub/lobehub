import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';
import { copyToClipboard } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import type { DragEvent, KeyboardEvent, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { startWorkspaceFileDrag } from '@/features/ChatInput/InputEditor/workspaceFileDragData';
import type {
  ExplorerTreeEntryKind,
  ExplorerTreeHandle,
  ExplorerTreeKeyDownCtx,
  ExplorerTreeNode,
} from '@/features/ExplorerTree';
import { usePublishWorkspaceHtmlFromFile } from '@/features/Portal/LocalFile/usePublishWorkspaceHtmlFromFile';
import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { isMacOS } from '@/utils/platform';

import { buildFileContextMenu, type FileMenuAction, type FileMenuTarget } from './fileContextMenu';
import { resolveFileTreeShortcut } from './fileTreeShortcuts';
import { getParentRelativePath, PROJECT_ROOT_NODE_ID } from './treePaths';
import { useFileOperations } from './useFileOperations';

type Node = ExplorerTreeNode<ProjectFileIndexEntry>;

interface UseFileTreeActionsParams {
  /** Files git reports deleted; their rows no longer exist on disk. */
  deletedPaths: Set<string>;
  deviceId?: string;
  dirtyFilePaths: Set<string>;
  expandedIds: string[];
  /** Search, the Git-changes view or a filter is narrowing the tree. */
  hasDisplayFilter: boolean;
  invalidateCollapsedChildren: () => void;
  knownEntries: ProjectFileIndexEntry[];
  nodes: Node[];
  onClearDisplayFilter: () => void;
  onCollapseAll: () => void;
  projectRoot: string;
  treeRef: RefObject<ExplorerTreeHandle | null>;
  workingDirectory: string;
}

interface PendingCreate {
  kind: ExplorerTreeEntryKind;
  parentId: string;
}

const isDeletedNode = (node: Node, deletedPaths: Set<string>) =>
  !!node.data && !node.isFolder && deletedPaths.has(node.data.relativePath);

/** Folder a write lands in when aimed at `node`: itself, or a file's parent. */
const targetFolderId = (node: Node | null | undefined): string => {
  if (!node?.data) return PROJECT_ROOT_NODE_ID;
  if (node.isFolder) return node.id;
  return getParentRelativePath(node.id) ?? PROJECT_ROOT_NODE_ID;
};

const folderRel = (folderId: string) => (folderId === PROJECT_ROOT_NODE_ID ? '' : folderId);

/**
 * Everything the Files tree hands to ExplorerTree and its header: context
 * menus for rows and the blank area, keyboard shortcuts, the header "New"
 * menu and refresh, drag start/drop, and inline create / rename commits.
 */
export const useFileTreeActions = ({
  deviceId,
  deletedPaths,
  dirtyFilePaths,
  expandedIds,
  hasDisplayFilter,
  invalidateCollapsedChildren,
  knownEntries,
  nodes,
  onClearDisplayFilter,
  onCollapseAll,
  projectRoot,
  treeRef,
  workingDirectory,
}: UseFileTreeActionsParams) => {
  const { t } = useTranslation('chat');
  const isRemote = !!deviceId;
  const openLocalFile = useChatStore((s) => s.openLocalFile);
  const openWorkingSidebar = useGlobalStore((s) => s.openWorkingSidebar);
  const { canOfferFile, publishFile } = usePublishWorkspaceHtmlFromFile({
    deviceId,
    workingDirectory: projectRoot,
  });
  const nodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const ops = useFileOperations({
    deviceId,
    dirtyFilePaths,
    expandedIds,
    invalidateCollapsedChildren,
    knownEntries,
    nodeIds,
    projectRoot,
    treeRef,
    workingDirectory,
  });

  // A new entry typed into a filtered tree would vanish from it, so creation
  // first drops the filters and opens the input once the full tree is back.
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const startCreate = useCallback(
    (parentId: string, kind: ExplorerTreeEntryKind) => {
      if (hasDisplayFilter || !treeRef.current) {
        onClearDisplayFilter();
        setPendingCreate({ kind, parentId });
        return;
      }
      ops.startCreate(parentId, kind);
    },
    [hasDisplayFilter, onClearDisplayFilter, ops, treeRef],
  );
  const startCreateRef = useRef(ops.startCreate);
  startCreateRef.current = ops.startCreate;
  useEffect(() => {
    if (!pendingCreate || hasDisplayFilter) return;
    const frame = requestAnimationFrame(() => {
      if (!treeRef.current) return;
      setPendingCreate(null);
      startCreateRef.current(pendingCreate.parentId, pendingCreate.kind);
    });
    return () => cancelAnimationFrame(frame);
  }, [hasDisplayFilter, nodes, pendingCreate, treeRef]);

  const openNode = useCallback(
    (node: Node) => {
      if (!node.data) return;
      if (node.isFolder) {
        if (!isRemote) void ops.openInSystem(node.data);
        return;
      }
      openLocalFile({ deviceId, filePath: node.data.path, workingDirectory: projectRoot });
    },
    [deviceId, isRemote, openLocalFile, ops, projectRoot],
  );

  const handleNodeClick = useCallback(
    (node: Node) => {
      // Folders expand via the tree; files open in the preview panel.
      if (node.isFolder) return;
      openNode(node);
    },
    [openNode],
  );

  // Dragging a row into the chat input inserts a `<localFile />` mention; the
  // tree itself moves rows on drop. The helper marks the drag copy-only for the
  // input, so widen it to copyMove or the tree's own "move" drop is refused.
  const handleNodeDragStart = useCallback((node: Node, event: DragEvent<HTMLElement>) => {
    if (!node.data) return;
    startWorkspaceFileDrag(event, {
      isDirectory: !!node.isFolder,
      name: node.data.name,
      path: node.data.path,
    });
    event.dataTransfer.effectAllowed = 'copyMove';
  }, []);

  /** Right-click on a row inside a multi-selection acts on the whole selection. */
  const entriesFor = useCallback(
    (node: Node): ProjectFileIndexEntry[] => {
      const selected = treeRef.current?.getSelectedIds() ?? [];
      const ids = selected.includes(node.id) ? selected : [node.id];
      return ids
        .map((id) => nodeById.get(id))
        .filter((item): item is Node => !!item?.data && !isDeletedNode(item, deletedPaths))
        .map((item) => item.data!);
    },
    [deletedPaths, nodeById, treeRef],
  );

  const copyText = useCallback(
    async (text: string) => {
      await copyToClipboard(text);
      toast.success(t('workingPanel.review.copied'));
    },
    [t],
  );

  const runAction = useCallback(
    (action: FileMenuAction, node: Node | null) => {
      const entry = node?.data;
      const folderId = targetFolderId(node);
      const folderPath = ops.toAbsolute(folderRel(folderId));
      switch (action) {
        case 'newFile':
        case 'newFolder': {
          startCreate(folderId, action === 'newFile' ? 'file' : 'folder');
          return;
        }
        case 'open': {
          if (node) openNode(node);
          return;
        }
        case 'openInSystem': {
          if (entry) void ops.openInSystem(entry);
          return;
        }
        case 'publish': {
          if (entry) void publishFile(entry.path);
          return;
        }
        case 'revealInSystem': {
          void localFileService.openFileFolder(entry?.path ?? projectRoot);
          return;
        }
        case 'openInTerminal': {
          void ops.openInTerminal(folderPath);
          return;
        }
        case 'showInReview': {
          openWorkingSidebar('review');
          return;
        }
        case 'copy':
        case 'cut': {
          if (node) ops.putOnClipboard(entriesFor(node), action);
          return;
        }
        case 'paste': {
          void ops.paste(folderRel(folderId));
          return;
        }
        case 'duplicate': {
          if (entry) void ops.duplicate(entry);
          return;
        }
        case 'copyPath': {
          void copyText(entry?.path ?? projectRoot);
          return;
        }
        case 'copyRelativePath': {
          if (entry) void copyText(entry.relativePath);
          return;
        }
        case 'rename': {
          if (node) treeRef.current?.startRenaming(node.id);
          return;
        }
        case 'trash': {
          if (node) ops.trash(entriesFor(node));
          return;
        }
        case 'refresh': {
          void ops.refresh();
          return;
        }
        case 'collapseAll': {
          onCollapseAll();
          return;
        }
      }
    },
    [
      copyText,
      entriesFor,
      onCollapseAll,
      openNode,
      openWorkingSidebar,
      ops,
      projectRoot,
      publishFile,
      startCreate,
      treeRef,
    ],
  );

  const menuEnv = useCallback(
    (canPublish: boolean) => ({
      canPaste: ops.canPaste,
      canPublish,
      canUseTerminal: ops.canUseTerminal,
      isRemote,
      trashName: ops.trashName,
    }),
    [isRemote, ops.canPaste, ops.canUseTerminal, ops.trashName],
  );

  const getBlankContextMenuItems = useCallback(
    () =>
      buildFileContextMenu(
        { kind: 'root' },
        menuEnv(false),
        (action) => runAction(action, null),
        t,
      ),
    [menuEnv, runAction, t],
  );

  const getContextMenuItems = useCallback(
    (node: Node) => {
      if (!node.data) return getBlankContextMenuItems();
      const target: FileMenuTarget = {
        isDeleted: isDeletedNode(node, deletedPaths),
        isDirty: dirtyFilePaths.has(node.data.relativePath),
        kind: node.isFolder ? 'folder' : 'file',
      };
      return buildFileContextMenu(
        target,
        menuEnv(canOfferFile(node.data.path, !!node.isFolder)),
        (action) => runAction(action, node),
        t,
      );
    },
    [canOfferFile, deletedPaths, dirtyFilePaths, getBlankContextMenuItems, menuEnv, runAction, t],
  );

  const isMac = useMemo(() => isMacOS(), []);
  const handleTreeKeyDown = useCallback(
    (
      event: KeyboardEvent<HTMLElement>,
      { focusedNode, selectedNodes }: ExplorerTreeKeyDownCtx<ProjectFileIndexEntry>,
    ) => {
      const shortcut = resolveFileTreeShortcut(event, isMac);
      if (!shortcut) return false;
      const targets =
        focusedNode && !selectedNodes.some((node) => node.id === focusedNode.id)
          ? [focusedNode]
          : selectedNodes;
      const entries = targets
        .filter((node) => node.data && !isDeletedNode(node, deletedPaths))
        .map((node) => node.data!);

      switch (shortcut) {
        case 'open': {
          if (!focusedNode) return false;
          if (!focusedNode.isFolder) {
            openNode(focusedNode);
            return true;
          }
          const expanded = expandedIds.includes(focusedNode.id);
          treeRef.current?.setExpanded(
            expanded
              ? expandedIds.filter((id) => id !== focusedNode.id)
              : [...expandedIds, focusedNode.id],
          );
          return true;
        }
        case 'delete': {
          if (entries.length === 0) return false;
          ops.trash(entries);
          return true;
        }
        case 'copy':
        case 'cut': {
          if (entries.length === 0) return false;
          ops.putOnClipboard(entries, shortcut);
          return true;
        }
        case 'paste': {
          if (!ops.canPaste) return false;
          void ops.paste(folderRel(targetFolderId(focusedNode)));
          return true;
        }
      }
    },
    [deletedPaths, expandedIds, isMac, openNode, ops, treeRef],
  );

  // Header "New" menu: into the selected folder, next to a selected file, or at the root.
  const startCreateFromHeader = useCallback(
    (kind: ExplorerTreeEntryKind) => {
      const [selectedId] = treeRef.current?.getSelectedIds() ?? [];
      startCreate(targetFolderId(selectedId ? nodeById.get(selectedId) : null), kind);
    },
    [nodeById, startCreate, treeRef],
  );

  return {
    canDrag: (node: Node) => !!node.data && !isDeletedNode(node, deletedPaths),
    canDrop: ops.canDrop,
    canRename: (node: Node) => !!node.data && !isDeletedNode(node, deletedPaths),
    getBlankContextMenuItems,
    getContextMenuItems,
    handleNodeClick,
    handleNodeDragStart,
    handleTreeKeyDown,
    onCommitCreate: ops.commitCreate,
    onCommitRename: ops.commitRename,
    onMove: ops.move,
    pendingCreate: !!pendingCreate,
    refresh: ops.refresh,
    refreshing: ops.refreshing,
    startCreateFromHeader,
    validateName: ops.validateName,
  };
};
