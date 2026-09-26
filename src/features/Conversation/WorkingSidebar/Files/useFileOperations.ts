import { isDesktop } from '@lobechat/const';
import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';
import { confirmModal, toast } from '@lobehub/ui/base-ui';
import { basename, join, relative } from 'pathe';
import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  ExplorerTreeCanDropCtx,
  ExplorerTreeCreateEvent,
  ExplorerTreeEntryKind,
  ExplorerTreeHandle,
  ExplorerTreeMoveEvent,
  ExplorerTreeNameCheck,
  ExplorerTreeNode,
} from '@/features/ExplorerTree';
import { localFileService } from '@/services/electron/localFileService';
import { projectFileService, refreshProjectFiles } from '@/services/projectFile';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { getPlatform } from '@/utils/platform';

import { getFileClipboardScopeKey, useFileClipboardStore } from './fileClipboard';
import { getFreeCopyName, type SiblingEntry, validateFileName } from './fileNameValidation';
import { classifyFileOpError } from './fileOpErrors';
import {
  getAncestorIds,
  getParentRelativePath,
  PROJECT_ROOT_NODE_ID,
  stripTrailingSlash,
  toEntryId,
} from './treePaths';

type Node = ExplorerTreeNode<ProjectFileIndexEntry>;

interface PendingSelection {
  id: string;
  open?: boolean;
  rename?: boolean;
}

interface UseFileOperationsParams {
  deviceId?: string;
  dirtyFilePaths: Set<string>;
  /** Folders expanded right now; a revealed entry's ancestors are added to them. */
  expandedIds: string[];
  /** Called after a write so lazily listed (git-ignored) folders are re-read too. */
  invalidateCollapsedChildren: () => void;
  /** Every entry the panel knows about, before display filters. */
  knownEntries: ProjectFileIndexEntry[];
  /** Ids currently in the tree; a pending selection is applied once its id shows up. */
  nodeIds: Set<string>;
  projectRoot: string;
  treeRef: RefObject<ExplorerTreeHandle | null>;
  /** Key the file index is cached under (the bound working directory). */
  workingDirectory: string;
}

/** Folder a node stands for as a write target: `''` is the project root. */
const dirRelOf = (node: Node | null): string =>
  !node || node.id === PROJECT_ROOT_NODE_ID || !node.data ? '' : node.data.relativePath;

/** Whether `dirRel` is the folder `entry` itself or lies inside it. */
const isInside = (
  entry: Pick<ProjectFileIndexEntry, 'isDirectory' | 'relativePath'>,
  dirRel: string,
) => entry.isDirectory && dirRel.startsWith(toEntryId(entry.relativePath, true));

const getTrashNameKey = (isRemote: boolean) => {
  if (isRemote) return 'linux';
  const platform = getPlatform();
  if (platform === 'Mac OS') return 'mac';
  if (platform === 'Windows') return 'windows';
  return 'linux';
};

/**
 * Every write the Files tree offers — create, rename, move, duplicate, copy /
 * cut / paste, trash — plus refresh and "open in terminal", for both the local
 * desktop and a remote device (the transport is picked in projectFileService).
 * After each write the file index, git overlay and lazily listed folders are
 * re-read, and the resulting entry is selected once it shows up in the tree.
 */
export const useFileOperations = ({
  deviceId,
  dirtyFilePaths,
  expandedIds,
  invalidateCollapsedChildren,
  knownEntries,
  nodeIds,
  projectRoot,
  treeRef,
  workingDirectory,
}: UseFileOperationsParams) => {
  const { t } = useTranslation('chat');
  const isRemote = !!deviceId;
  const openLocalFile = useChatStore((s) => s.openLocalFile);
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const toggleTerminalPanel = useGlobalStore((s) => s.toggleTerminalPanel);
  const [refreshing, setRefreshing] = useState(false);
  const pendingSelectionRef = useRef<PendingSelection | null>(null);
  const expandedIdsRef = useRef(expandedIds);
  expandedIdsRef.current = expandedIds;

  const scopeKey = getFileClipboardScopeKey(deviceId, projectRoot);
  const clipboard = useFileClipboardStore((s) =>
    s.clipboard?.scopeKey === scopeKey ? s.clipboard : undefined,
  );
  const setClipboard = useFileClipboardStore((s) => s.set);
  const clearClipboard = useFileClipboardStore((s) => s.clear);

  const trashName = t(`workingPanel.files.trashName.${getTrashNameKey(isRemote)}`);
  // macOS / Windows disks ignore case; a remote device may be Linux, so be strict there.
  const caseInsensitive = useMemo(() => {
    if (isRemote) return false;
    const platform = getPlatform();
    return platform === 'Mac OS' || platform === 'Windows';
  }, [isRemote]);

  const siblingsOf = useCallback(
    (dirRel: string): SiblingEntry[] => {
      const parent = dirRel === '' ? null : dirRel;
      return knownEntries
        .filter((entry) => getParentRelativePath(entry.relativePath) === parent)
        .map((entry) => ({ isDirectory: entry.isDirectory, name: entry.name }));
    },
    [knownEntries],
  );

  const toAbsolute = useCallback(
    (rel: string) => (rel === '' ? projectRoot : join(projectRoot, stripTrailingSlash(rel))),
    [projectRoot],
  );
  const toRelative = useCallback(
    (absolutePath: string) => relative(projectRoot, absolutePath),
    [projectRoot],
  );

  const reasonOf = useCallback(
    (error: unknown) => {
      const { kind, message } = classifyFileOpError(error);
      switch (kind) {
        case 'offline': {
          return t('workingPanel.files.feedback.deviceOffline');
        }
        case 'unsupported': {
          return t('workingPanel.files.feedback.unsupportedOnDevice');
        }
        case 'trashUnsupported': {
          return t('workingPanel.files.feedback.trashUnsupported', { trash: trashName });
        }
        default: {
          return message;
        }
      }
    },
    [t, trashName],
  );

  /** Re-read everything the tree shows, then select `selection` once it exists. */
  const afterWrite = useCallback(
    async (selection?: PendingSelection) => {
      pendingSelectionRef.current = selection ?? null;
      invalidateCollapsedChildren();
      await refreshProjectFiles(deviceId, workingDirectory);
    },
    [deviceId, invalidateCollapsedChildren, workingDirectory],
  );

  // Apply a pending selection when the refreshed nodes contain it: expand its
  // ancestors, select and focus it, then open or rename it as requested.
  useEffect(() => {
    const pending = pendingSelectionRef.current;
    if (!pending || !nodeIds.has(pending.id)) return;
    pendingSelectionRef.current = null;
    const tree = treeRef.current;
    if (!tree) return;
    const ancestors = [PROJECT_ROOT_NODE_ID, ...getAncestorIds(pending.id)];
    const self = pending.id.endsWith('/') ? [pending.id] : [];
    tree.setExpanded([...new Set([...expandedIdsRef.current, ...ancestors, ...self])]);
    tree.select(pending.id);
    tree.focus(pending.id);
    if (pending.rename) tree.startRenaming(pending.id);
    if (pending.open && !pending.id.endsWith('/')) {
      openLocalFile({ deviceId, filePath: toAbsolute(pending.id), workingDirectory: projectRoot });
    }
  }, [deviceId, nodeIds, openLocalFile, projectRoot, toAbsolute, treeRef]);

  const validateName = useCallback(
    (check: ExplorerTreeNameCheck<ProjectFileIndexEntry>) => {
      const error =
        check.mode === 'create'
          ? validateFileName({
              allowNested: true,
              caseInsensitive,
              name: check.name,
              siblings: siblingsOf(dirRelOf(check.parentNode)),
            })
          : validateFileName({
              allowNested: false,
              caseInsensitive,
              currentName: check.node.name,
              name: check.name,
              siblings: siblingsOf(getParentRelativePath(check.node.id) ?? ''),
            });
      return error
        ? t(`workingPanel.files.validation.${error}`, { name: check.name.split('/')[0] })
        : null;
    },
    [caseInsensitive, siblingsOf, t],
  );

  const commitCreate = useCallback(
    async ({ kind, name, parentNode }: ExplorerTreeCreateEvent<ProjectFileIndexEntry>) => {
      const dirRel = dirRelOf(parentNode);
      const path = join(toAbsolute(dirRel), name);
      try {
        const result =
          kind === 'folder'
            ? await projectFileService.createProjectDirectory({
                deviceId,
                path,
                workingDirectory: projectRoot,
              })
            : await projectFileService.createProjectFile({
                deviceId,
                path,
                workingDirectory: projectRoot,
              });
        if (!result.success) throw new Error(result.error || 'Unknown error');
      } catch (error) {
        toast.error(
          t('workingPanel.files.feedback.createFailed', { name, reason: reasonOf(error) }),
        );
        await afterWrite();
        return false;
      }
      await afterWrite({
        id: toEntryId(
          `${stripTrailingSlash(dirRel)}${dirRel ? '/' : ''}${name}`,
          kind === 'folder',
        ),
        open: kind === 'file',
      });
    },
    [afterWrite, deviceId, projectRoot, reasonOf, t, toAbsolute],
  );

  const commitRename = useCallback(
    async (node: Node, newName: string) => {
      if (!node.data) return false;
      try {
        const result = await projectFileService.renameProjectFile({
          deviceId,
          newName,
          path: node.data.path,
          workingDirectory: projectRoot,
        });
        if (!result.success) throw new Error(String(result.error || 'Unknown error'));
      } catch (error) {
        toast.error(
          t('workingPanel.files.feedback.renameFailed', {
            name: node.data.name,
            reason: reasonOf(error),
          }),
        );
        await afterWrite();
        return false;
      }
      const parentRel = getParentRelativePath(node.id) ?? '';
      await afterWrite({ id: toEntryId(`${parentRel}${newName}`, !!node.isFolder) });
    },
    [afterWrite, deviceId, projectRoot, reasonOf, t],
  );

  /** Moves entries into `targetDirRel`, skipping (and reporting) name clashes. */
  const moveInto = useCallback(
    async (entries: ProjectFileIndexEntry[], targetDirRel: string) => {
      const fold = (value: string) => (caseInsensitive ? value.toLowerCase() : value);
      const taken = new Set(siblingsOf(targetDirRel).map((sibling) => fold(sibling.name)));
      const movable = entries.filter((entry) => {
        if (getParentRelativePath(entry.relativePath) === (targetDirRel || null)) return false;
        if (!taken.has(fold(entry.name))) return true;
        toast.error(t('workingPanel.files.feedback.moveConflict', { name: entry.name }));
        return false;
      });
      if (movable.length === 0) return entries.length === 0;

      const targetDir = toAbsolute(targetDirRel);
      let results;
      try {
        results = await projectFileService.moveProjectFiles({
          deviceId,
          items: movable.map((entry) => ({
            newPath: join(targetDir, entry.name),
            oldPath: entry.path,
          })),
          workingDirectory: projectRoot,
        });
      } catch (error) {
        const reason = reasonOf(error);
        for (const entry of movable) {
          toast.error(t('workingPanel.files.feedback.moveFailed', { name: entry.name, reason }));
        }
        await afterWrite();
        return false;
      }
      const failed = results.filter((result) => !result.success);
      for (const result of failed) {
        toast.error(
          t('workingPanel.files.feedback.moveFailed', {
            name: basename(result.sourcePath),
            reason: reasonOf(result.error),
          }),
        );
      }
      const moved = results.find((result) => result.success && result.newPath);
      const movedEntry = moved && movable.find((entry) => entry.path === moved.sourcePath);
      await afterWrite(
        moved?.newPath && movedEntry
          ? { id: toEntryId(toRelative(moved.newPath), movedEntry.isDirectory) }
          : undefined,
      );
      return failed.length === 0;
    },
    [
      afterWrite,
      caseInsensitive,
      deviceId,
      projectRoot,
      reasonOf,
      siblingsOf,
      t,
      toAbsolute,
      toRelative,
    ],
  );

  const canDrop = useCallback(
    ({ sourceNodes, targetNode }: ExplorerTreeCanDropCtx<ProjectFileIndexEntry>) => {
      const targetDirRel = dirRelOf(targetNode);
      if (targetNode && !targetNode.isFolder) return false;
      const fold = (value: string) => (caseInsensitive ? value.toLowerCase() : value);
      const taken = new Set(siblingsOf(targetDirRel).map((sibling) => fold(sibling.name)));
      return sourceNodes.every((node) => {
        const entry = node.data;
        if (!entry || node.id === PROJECT_ROOT_NODE_ID) return false;
        if (isInside(entry, targetDirRel)) return false;
        // Dropping back into its own folder is a no-op, not a clash.
        if (getParentRelativePath(entry.relativePath) === (targetDirRel || null)) return true;
        return !taken.has(fold(entry.name));
      });
    },
    [caseInsensitive, siblingsOf],
  );

  const move = useCallback(
    async ({ newParentId, sourceNodes }: ExplorerTreeMoveEvent<ProjectFileIndexEntry>) => {
      const targetDirRel = newParentId && newParentId !== PROJECT_ROOT_NODE_ID ? newParentId : '';
      const entries = sourceNodes.flatMap((node) => (node.data ? [node.data] : []));
      if (entries.some((entry) => isInside(entry, targetDirRel))) return false;
      return moveInto(entries, targetDirRel);
    },
    [moveInto],
  );

  const trash = useCallback(
    (entries: ProjectFileIndexEntry[]) => {
      if (entries.length === 0) return;
      const [first] = entries;
      const isDirty = entries.some((entry) =>
        entry.isDirectory
          ? [...dirtyFilePaths].some((path) => path.startsWith(toEntryId(entry.relativePath, true)))
          : dirtyFilePaths.has(entry.relativePath),
      );
      const description =
        entries.length > 1
          ? t('workingPanel.files.delete.multipleDesc', { trash: trashName })
          : first.isDirectory
            ? t('workingPanel.files.delete.folderDesc', { name: first.name, trash: trashName })
            : t('workingPanel.files.delete.fileDesc', { trash: trashName });

      confirmModal({
        content: isDirty
          ? `${description} ${t('workingPanel.files.delete.dirtyWarning')}`
          : description,
        okButtonProps: { danger: true },
        okText: t('workingPanel.files.delete.confirm', { trash: trashName }),
        onOk: async () => {
          let items: { error?: string; path: string; success: boolean }[];
          try {
            const result = await projectFileService.trashProjectFiles({
              deviceId,
              paths: entries.map((entry) => entry.path),
              workingDirectory: projectRoot,
            });
            items = result.items;
          } catch (error) {
            const reason = reasonOf(error);
            toast.error(
              t('workingPanel.files.feedback.deleteFailed', {
                name: entries.length > 1 ? String(entries.length) : first.name,
                reason,
              }),
            );
            return;
          }
          const trashed = items.filter((item) => item.success);
          if (trashed.length === 1) {
            toast.success(
              t('workingPanel.files.feedback.trashed', {
                name: basename(trashed[0].path),
                trash: trashName,
              }),
            );
          } else if (trashed.length > 1) {
            toast.success(
              t('workingPanel.files.feedback.trashedCount', {
                count: trashed.length,
                trash: trashName,
              }),
            );
          }
          for (const item of items.filter((result) => !result.success)) {
            toast.error(
              t('workingPanel.files.feedback.deleteFailed', {
                name: basename(item.path),
                reason: reasonOf(item.error),
              }),
            );
          }
          const parentRel = getParentRelativePath(first.relativePath);
          await afterWrite(parentRel ? { id: parentRel } : undefined);
        },
        title:
          entries.length > 1
            ? t('workingPanel.files.delete.confirmTitleMultiple', {
                count: entries.length,
                trash: trashName,
              })
            : t('workingPanel.files.delete.confirmTitle', { name: first.name, trash: trashName }),
      });
    },
    [afterWrite, deviceId, dirtyFilePaths, projectRoot, reasonOf, t, trashName],
  );

  const duplicate = useCallback(
    async (entry: ProjectFileIndexEntry) => {
      try {
        const [result] = await projectFileService.copyProjectFiles({
          deviceId,
          items: [{ sourcePath: entry.path }],
          workingDirectory: projectRoot,
        });
        if (!result?.success || !result.targetPath) {
          throw new Error(result?.error || 'Unknown error');
        }
        await afterWrite({
          id: toEntryId(toRelative(result.targetPath), entry.isDirectory),
          rename: true,
        });
      } catch (error) {
        toast.error(
          t('workingPanel.files.feedback.duplicateFailed', {
            name: entry.name,
            reason: reasonOf(error),
          }),
        );
      }
    },
    [afterWrite, deviceId, projectRoot, reasonOf, t, toRelative],
  );

  const putOnClipboard = useCallback(
    (entries: ProjectFileIndexEntry[], mode: 'copy' | 'cut') => {
      if (entries.length === 0) return;
      setClipboard({
        items: entries.map(({ isDirectory, name, path }) => ({ isDirectory, name, path })),
        mode,
        scopeKey,
      });
    },
    [scopeKey, setClipboard],
  );

  const paste = useCallback(
    async (targetDirRel: string) => {
      if (!clipboard) return;
      const entries = clipboard.items.map((item) => ({
        ...item,
        relativePath: toEntryId(toRelative(item.path), item.isDirectory),
      }));
      const intoItself = entries.find((entry) => isInside(entry, targetDirRel));
      if (intoItself) {
        toast.error(t('workingPanel.files.feedback.pasteIntoItself', { name: intoItself.name }));
        return;
      }

      if (clipboard.mode === 'cut') {
        if (await moveInto(entries, targetDirRel)) clearClipboard();
        return;
      }

      const siblings = [...siblingsOf(targetDirRel)];
      const targetDir = toAbsolute(targetDirRel);
      const items = entries.map((entry) => {
        const name = getFreeCopyName(entry.name, entry.isDirectory, siblings, caseInsensitive);
        siblings.push({ isDirectory: entry.isDirectory, name });
        return { sourcePath: entry.path, targetPath: join(targetDir, name) };
      });
      let results;
      try {
        results = await projectFileService.copyProjectFiles({
          deviceId,
          items,
          workingDirectory: projectRoot,
        });
      } catch (error) {
        const reason = reasonOf(error);
        for (const entry of entries) {
          toast.error(t('workingPanel.files.feedback.pasteFailed', { name: entry.name, reason }));
        }
        return;
      }
      for (const result of results.filter((item) => !item.success)) {
        toast.error(
          t('workingPanel.files.feedback.pasteFailed', {
            name: basename(result.sourcePath),
            reason: reasonOf(result.error),
          }),
        );
      }
      const copied = results.find((result) => result.success && result.targetPath);
      const copiedEntry = copied && entries.find((entry) => entry.path === copied.sourcePath);
      await afterWrite(
        copied?.targetPath && copiedEntry
          ? { id: toEntryId(toRelative(copied.targetPath), copiedEntry.isDirectory) }
          : undefined,
      );
    },
    [
      afterWrite,
      caseInsensitive,
      clearClipboard,
      clipboard,
      deviceId,
      moveInto,
      projectRoot,
      reasonOf,
      siblingsOf,
      t,
      toAbsolute,
      toRelative,
    ],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await afterWrite();
    } catch {
      toast.error(t('workingPanel.files.feedback.refreshFailed'));
    } finally {
      setRefreshing(false);
    }
  }, [afterWrite, t]);

  const openInSystem = useCallback(
    async (entry: ProjectFileIndexEntry) => {
      try {
        const result = await localFileService.openLocalFileOrFolder(entry.path, true);
        if (result && result.success === false) throw new Error(result.error);
      } catch {
        toast.error(t('workingPanel.files.feedback.openFailed', { name: entry.name }));
      }
    },
    [t],
  );

  const canUseTerminal = isDesktop && !isRemote;
  const openInTerminal = useCallback(
    async (cwd: string) => {
      // The terminal store pulls in xterm; load it only when a terminal is asked for.
      const { useChatTerminalStore } = await import('@/features/ChatTerminal/store');
      const topicKey = activeTopicId || (activeAgentId ? `agent:${activeAgentId}` : 'global');
      await useChatTerminalStore.getState().createTab(topicKey, cwd);
      if (useChatTerminalStore.getState().createErrors[topicKey]) {
        toast.error(t('workingPanel.files.feedback.terminalFailed'));
        return;
      }
      toggleTerminalPanel(true);
    },
    [activeAgentId, activeTopicId, t, toggleTerminalPanel],
  );

  const startCreate = useCallback(
    (parentId: string, kind: ExplorerTreeEntryKind) =>
      treeRef.current?.startCreating(parentId, kind),
    [treeRef],
  );

  return {
    canDrop,
    canPaste: !!clipboard,
    canUseTerminal,
    clipboard,
    commitCreate,
    commitRename,
    duplicate,
    move,
    openInSystem,
    openInTerminal,
    paste,
    putOnClipboard,
    refresh,
    refreshing,
    startCreate,
    toAbsolute,
    trash,
    trashName,
    validateName,
  };
};
