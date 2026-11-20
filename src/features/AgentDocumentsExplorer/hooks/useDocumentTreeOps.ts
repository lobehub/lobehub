import { FileSource } from '@lobechat/types';
import { confirmModal, toast } from '@lobehub/ui';
import { nanoid } from 'nanoid';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { FILE_UPLOAD_BLACKLIST } from '@/const/file';
import { useSingleton } from '@/hooks/useSingleton';
import { agentDocumentService } from '@/services/agentDocument';
import { fileService } from '@/services/file';
import { useFileStore } from '@/store/file';

import type { AgentDocumentItem, AgentDocumentListMutator } from '../types';
import { isPendingId, isProtectedManagedSkillItem } from '../types';
import { makePendingDocument } from '../utils/pendingDocument';

interface UseDocumentTreeOpsArgs {
  agentId: string;
  data: AgentDocumentItem[];
  mutate: AgentDocumentListMutator;
  topicId?: string;
}

// Service mutations return the agent-document row with its id exposed as `id`
// (and mirrored on `agentDocumentId`). Extract defensively since tRPC narrows
// the type per-route.
const extractRowId = (result: unknown): string | null => {
  if (!result || typeof result !== 'object') return null;
  const obj = result as Record<string, unknown>;
  const id = obj.id ?? obj.agentDocumentId;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

export interface CreateOptions {
  /**
   * Fires synchronously right after the optimistic pending row is inserted,
   * passing the pending row's id. Used by the tree to immediately enter the
   * rename input on the new row, before the server response lands.
   */
  onPendingInserted?: (pendingId: string) => void;
}

export interface DocumentTreeOps {
  createDocument: (parentId: string | null, opts?: CreateOptions) => Promise<void>;
  createFolder: (parentId: string | null, opts?: CreateOptions) => Promise<void>;
  deleteDocuments: (ids: string[]) => void;
  moveDocument: (params: {
    sourceIds: string[];
    sourceNodes: { data?: AgentDocumentItem }[];
    targetId: string | null;
  }) => Promise<void>;
  renameDocument: (id: string, newName: string) => Promise<void>;
  uploadFiles: (parentId: string | null, files: File[]) => Promise<void>;
}

export const useDocumentTreeOps = ({
  agentId,
  data,
  mutate,
  topicId,
}: UseDocumentTreeOpsArgs): DocumentTreeOps => {
  const { t } = useTranslation(['chat', 'common']);

  const dataRef = useRef(data);
  dataRef.current = data;

  // Tracks in-flight creates so a rename committed before the server response
  // lands can be deferred to the real row id once the create resolves.
  const pendingCreates = useSingleton(() => new Map<string, Promise<string | null>>());

  const byRowId = useMemo(() => {
    const map = new Map<string, AgentDocumentItem>();
    for (const doc of data) map.set(doc.id, doc);
    return map;
  }, [data]);

  // Resolves a tree-node parent id (= row id, null for the root) to the parent's
  // documentId. Folders and plain documents can both hold children; `undefined`
  // means the parent is gone or cannot hold children (skills).
  const resolveParentDocumentId = useCallback(
    (parentRowId: string | null): string | null | undefined => {
      if (parentRowId === null) return null;
      const parent = byRowId.get(parentRowId);
      if (!parent || parent.category === 'skill') return undefined;
      return parent.documentId;
    },
    [byRowId],
  );

  // Picks a unique filename within the given parent. Used for client-side
  // dedup of "Untitled" rows because createFolder is idempotent (same name
  // re-uses the existing folder). When an extension is provided, the
  // numeric suffix is inserted before the extension so the file keeps its
  // type (e.g. `Untitled document 2.md`).
  const pickUniqueFilename = useCallback(
    (parentDocumentId: string | null, baseStem: string, extension = ''): string => {
      const siblings = dataRef.current.filter((doc) => (doc.parentId ?? null) === parentDocumentId);
      const taken = new Set(siblings.map((doc) => doc.filename));
      const first = `${baseStem}${extension}`;
      if (!taken.has(first)) return first;
      for (let i = 2; i < 1000; i += 1) {
        const candidate = `${baseStem} ${i}${extension}`;
        if (!taken.has(candidate)) return candidate;
      }
      return `${baseStem} ${Date.now()}${extension}`;
    },
    [],
  );

  const createFolder = useCallback(
    async (parentId: string | null, opts?: CreateOptions) => {
      const parentDocumentId = resolveParentDocumentId(parentId);
      if (parentDocumentId === undefined) {
        toast.error(t('workingPanel.resources.tree.parentMissing'));
        return;
      }

      const baseName = t('workingPanel.resources.tree.untitledFolder');
      const filename = pickUniqueFilename(parentDocumentId, baseName);

      const pending = makePendingDocument({
        agentId,
        isFolder: true,
        parentId: parentDocumentId,
        title: filename,
      });
      mutate((prev) => [...(prev ?? []), pending], { revalidate: false });
      opts?.onPendingInserted?.(pending.id);

      const createPromise = (async (): Promise<string | null> => {
        try {
          const result = await agentDocumentService.createFolderById({
            agentId,
            parentId: parentDocumentId,
            title: filename,
          });
          await mutate();
          return extractRowId(result?.folder);
        } catch (error) {
          mutate((prev) => (prev ?? []).filter((doc) => doc.id !== pending.id), {
            revalidate: false,
          });
          toast.error(
            error instanceof Error
              ? `${t('workingPanel.resources.tree.createError')}: ${error.message}`
              : t('workingPanel.resources.tree.createError'),
          );
          return null;
        } finally {
          pendingCreates.delete(pending.id);
        }
      })();

      pendingCreates.set(pending.id, createPromise);
      await createPromise;
    },
    [agentId, mutate, pendingCreates, pickUniqueFilename, resolveParentDocumentId, t],
  );

  const createDocument = useCallback(
    async (parentId: string | null, opts?: CreateOptions) => {
      const parentDocumentId = resolveParentDocumentId(parentId);
      if (parentDocumentId === undefined) {
        toast.error(t('workingPanel.resources.tree.parentMissing'));
        return;
      }

      const baseStem = t('workingPanel.resources.tree.untitledDocument');
      const pendingFilename = pickUniqueFilename(parentDocumentId, baseStem);

      const pending = makePendingDocument({
        agentId,
        isFolder: false,
        parentId: parentDocumentId,
        title: pendingFilename,
      });
      mutate((prev) => [...(prev ?? []), pending], { revalidate: false });
      opts?.onPendingInserted?.(pending.id);

      const createPromise = (async (): Promise<string | null> => {
        try {
          const result = await agentDocumentService.createDocument({
            agentId,
            content: '',
            ...(parentDocumentId && { parentId: parentDocumentId }),
            title: pendingFilename,
          });
          await mutate();
          return extractRowId(result);
        } catch (error) {
          mutate((prev) => (prev ?? []).filter((doc) => doc.id !== pending.id), {
            revalidate: false,
          });
          toast.error(
            error instanceof Error
              ? `${t('workingPanel.resources.tree.createError')}: ${error.message}`
              : t('workingPanel.resources.tree.createError'),
          );
          return null;
        } finally {
          pendingCreates.delete(pending.id);
        }
      })();

      pendingCreates.set(pending.id, createPromise);
      await createPromise;
    },
    [agentId, mutate, pendingCreates, pickUniqueFilename, resolveParentDocumentId, t],
  );

  const uploadFiles = useCallback(
    async (parentId: string | null, files: File[]) => {
      const parentDocumentId = resolveParentDocumentId(parentId);
      if (parentDocumentId === undefined) {
        toast.error(t('workingPanel.resources.tree.parentMissing'));
        return;
      }

      const accepted = files.filter((file) => !FILE_UPLOAD_BLACKLIST.includes(file.name));
      if (accepted.length === 0) return;

      const { dispatchDockFileList, uploadWithProgress } = useFileStore.getState();

      for (const file of accepted) {
        const abortController = new AbortController();
        const uploadId = `upload_${nanoid(12)}`;

        dispatchDockFileList({
          atStart: true,
          files: [{ abortController, file, id: uploadId, status: 'pending' }],
          type: 'addFiles',
        });

        try {
          const result = await uploadWithProgress({
            abortController,
            file,
            onStatusUpdate: dispatchDockFileList,
            skipCheckFileType: true,
            source: FileSource.AgentDocument,
            uploadId,
          });

          if (!result?.id) continue;

          try {
            await agentDocumentService.importFile({
              agentId,
              fileId: result.id,
              parentId: parentDocumentId,
            });
          } catch (error) {
            // Also covers transport/auth failures before import reaches the server.
            // A committed import is protected by the server's reference checks.
            await fileService.removeUnreferencedFile(result.id).catch((cleanupError) => {
              console.error('Failed to reclaim an unbound agent upload', cleanupError);
            });
            throw error;
          }
          await mutate();
        } catch (error) {
          toast.error(
            error instanceof Error
              ? `${t('workingPanel.resources.tree.uploadError')}: ${error.message}`
              : t('workingPanel.resources.tree.uploadError'),
          );
        }
      }
    },
    [agentId, mutate, resolveParentDocumentId, t],
  );

  const renameDocument = useCallback(
    async (id: string, newName: string) => {
      const target = dataRef.current.find((doc) => doc.id === id);
      if (!target) return;
      if (target.category === 'skill') return;

      const trimmed = newName.trim();
      if (!trimmed) {
        toast.warning(t('workingPanel.resources.renameEmpty'));
        return;
      }
      if (trimmed === target.title) return;

      // If the row is a pending optimistic insert, wait for the create to
      // resolve so we can rename against the real server-side id. Once the
      // pending row is replaced by the real row (same path) the tree's
      // path-based rename state survives the hydration, so the user's input
      // stays intact.
      if (isPendingId(id)) {
        const pendingPromise = pendingCreates.get(id);
        if (!pendingPromise) return;
        const realId = await pendingPromise;
        if (!realId) return;
        // Bail out if the real row already carries the desired name (e.g.
        // server returned with the trimmed name applied).
        const real = dataRef.current.find((doc) => doc.id === realId);
        if (real && real.title === trimmed) return;
        return renameDocument(realId, trimmed);
      }

      mutate(
        (prev) =>
          (prev ?? []).map((doc) =>
            doc.id === id ? { ...doc, filename: trimmed, title: trimmed } : doc,
          ),
        { revalidate: false },
      );

      try {
        await agentDocumentService.renameDocument({ agentId, id, newTitle: trimmed });
        toast.success(t('workingPanel.resources.renameSuccess'));
      } catch (error) {
        // rollback
        mutate(
          (prev) =>
            (prev ?? []).map((doc) =>
              doc.id === id ? { ...doc, filename: target.filename, title: target.title } : doc,
            ),
          { revalidate: false },
        );
        toast.error(
          error instanceof Error ? error.message : t('workingPanel.resources.renameError'),
        );
      }
    },
    [agentId, mutate, pendingCreates, t],
  );

  const moveDocument: DocumentTreeOps['moveDocument'] = useCallback(
    async ({ sourceIds, sourceNodes, targetId }) => {
      if (sourceIds.length === 0) return;

      const targetItem = targetId ? byRowId.get(targetId) : null;
      if (targetItem?.isSkillBundle) return;
      const targetParentDocId = resolveParentDocumentId(targetId);
      if (targetParentDocId === undefined) {
        toast.error(t('workingPanel.resources.tree.parentMissing'));
        return;
      }

      const ids: string[] = [];
      for (const id of sourceIds) {
        const node = sourceNodes.find((n) => n.data?.id === id)?.data;
        if (!node) continue;
        if (node.category === 'skill') return;
        if ((node.parentId ?? null) === targetParentDocId) continue;
        ids.push(id);
      }

      if (ids.length === 0) return;

      // Optimistic: reparent each source row to the new parent's documentId.
      const movedIds = new Set(ids);
      mutate(
        (prev) =>
          (prev ?? []).map((doc) =>
            movedIds.has(doc.id) ? { ...doc, parentId: targetParentDocId } : doc,
          ),
        { revalidate: false },
      );

      let failures: string[];
      try {
        const results = await agentDocumentService.moveDocumentsById({
          agentId,
          ids,
          parentId: targetParentDocId,
        });
        failures = (results ?? [])
          .filter((result) => result.status === 'failed')
          .map((result) => result.error ?? result.title ?? result.id);
      } catch (error) {
        failures = [error instanceof Error ? error.message : String(error)];
      }

      await mutate();

      if (failures.length > 0) {
        toast.error(`${t('workingPanel.resources.tree.moveError')}: ${failures.join('; ')}`);
      }
    },
    [agentId, byRowId, mutate, resolveParentDocumentId, t],
  );

  const deleteDocuments = useCallback(
    (ids: string[]) => {
      const uniqueIds = Array.from(new Set(ids));
      const resolved = uniqueIds
        .map((id) => dataRef.current.find((doc) => doc.id === id))
        .filter((doc): doc is AgentDocumentItem => !!doc)
        .filter((doc) => !isProtectedManagedSkillItem(doc, dataRef.current));

      if (resolved.length === 0) return;

      // When a selected entry is an ancestor of another selection, skip the
      // descendant — the ancestor's subtree delete already covers it. Folders and
      // documents with nested documents both delete their subtree.
      const docById = new Map(dataRef.current.map((doc) => [doc.documentId, doc]));
      const folderDocIds = new Set(resolved.map((doc) => doc.documentId));
      const hasAncestorIn = (item: AgentDocumentItem, ancestors: Set<string>): boolean => {
        let cursor = item.parentId;
        while (cursor) {
          if (ancestors.has(cursor)) return true;
          cursor = docById.get(cursor)?.parentId ?? null;
        }
        return false;
      };
      const targets = resolved.filter((doc) => !hasAncestorIn(doc, folderDocIds));

      if (targets.length === 0) return;

      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('workingPanel.resources.deleteConfirm'),
        okButtonProps: { danger: true },
        okText: t('delete', { ns: 'common' }),
        onOk: () => {
          const removedIds = new Set<string>();

          for (const target of targets) {
            removedIds.add(target.id);
            const queue: string[] = [target.documentId];
            while (queue.length > 0) {
              const parentDocId = queue.shift()!;
              for (const doc of dataRef.current) {
                if (doc.parentId === parentDocId && !removedIds.has(doc.id)) {
                  removedIds.add(doc.id);
                  queue.push(doc.documentId);
                }
              }
            }
          }

          const snapshot = dataRef.current;
          mutate((prev) => (prev ?? []).filter((doc) => !removedIds.has(doc.id)), {
            revalidate: false,
          });

          void (async () => {
            const errors: Error[] = [];
            await Promise.all(
              targets.map(async (target) => {
                try {
                  // The user confirmed deleting the entry with everything under it.
                  await agentDocumentService.removeDocument({
                    agentId,
                    documentId: target.documentId,
                    id: target.id,
                    topicId,
                    withChildren: true,
                  });
                } catch (error) {
                  errors.push(error instanceof Error ? error : new Error(String(error)));
                }
              }),
            );

            if (errors.length === targets.length) {
              mutate(snapshot, { revalidate: false });
              const detail = errors.map((e) => e.message).join('; ');
              toast.error(`${t('workingPanel.resources.deleteError')}: ${detail}`);
              return;
            }

            await mutate();
            if (errors.length > 0) {
              const detail = errors.map((e) => e.message).join('; ');
              toast.error(`${t('workingPanel.resources.deleteError')}: ${detail}`);
            }
          })();
        },
        title:
          targets.length > 1
            ? t('workingPanel.resources.deleteTitleMulti', { count: targets.length })
            : t('workingPanel.resources.deleteTitle'),
      });
    },
    [agentId, mutate, t, topicId],
  );

  return useMemo(
    () => ({
      createDocument,
      createFolder,
      deleteDocuments,
      moveDocument,
      renameDocument,
      uploadFiles,
    }),
    [createDocument, createFolder, deleteDocuments, moveDocument, renameDocument, uploadFiles],
  );
};
