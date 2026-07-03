import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { KeyedMutator } from 'swr';

import { agentDocumentService } from '@/services/agentDocument';

import type { AgentDocumentItem } from '../types';
import { isPendingId, isProtectedManagedSkillItem } from '../types';
import { makePendingDocument } from '../utils/pendingDocument';

interface UseDocumentTreeOpsArgs {
  agentId: string;
  data: AgentDocumentItem[];
  mutate: KeyedMutator<AgentDocumentItem[]>;
  topicId?: string;
}

const ROOT_PATH = './';

const joinPath = (parentPath: string, segment: string) =>
  parentPath === ROOT_PATH ? `${ROOT_PATH}${segment}` : `${parentPath}/${segment}`;

// Service mutations return AgentDocumentStats-shaped payloads where the
// agentDocumentItems row id is exposed as `id` (and mirrored on
// `agentDocumentId`). Extract defensively since tRPC narrows the type
// per-route.
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
}

export const useDocumentTreeOps = ({
  agentId,
  data,
  mutate,
  topicId,
}: UseDocumentTreeOpsArgs): DocumentTreeOps => {
  const { t } = useTranslation(['chat', 'common']);
  const { message } = App.useApp();
  const dataRef = useRef(data);
  dataRef.current = data;

  // Tracks in-flight creates so a rename committed before the server response
  // lands can be deferred to the real row id once the create resolves.
  const pendingCreatesRef = useRef(new Map<string, Promise<string | null>>());

  const byRowId = useMemo(() => {
    const map = new Map<string, AgentDocumentItem>();
    for (const doc of data) map.set(doc.id, doc);
    return map;
  }, [data]);

  const byDocumentId = useMemo(() => {
    const map = new Map<string, AgentDocumentItem>();
    for (const doc of data) map.set(doc.documentId, doc);
    return map;
  }, [data]);

  // Walk up via item.parentId (= parent's documentId) until we hit the root.
  const buildItemPath = useCallback(
    (item: AgentDocumentItem): string | null => {
      const segments: string[] = [item.filename];
      let parentDocId = item.parentId;
      while (parentDocId) {
        const parent = byDocumentId.get(parentDocId);
        if (!parent) return null;
        segments.unshift(parent.filename);
        parentDocId = parent.parentId;
      }
      return `${ROOT_PATH}${segments.join('/')}`;
    },
    [byDocumentId],
  );

  // Resolves the parent's path given a tree-node parent id (= row id) or null.
  const buildParentPathFromRowId = useCallback(
    (parentRowId: string | null): string | null => {
      if (parentRowId === null) return ROOT_PATH;
      const parent = byRowId.get(parentRowId);
      if (!parent) return null;
      if (parent.category === 'skill') return null;
      return buildItemPath(parent);
    },
    [byRowId, buildItemPath],
  );

  // Picks a unique filename within the given parent. Used for client-side
  // dedup of "Untitled" rows because the path-based VFS mkdir is idempotent
  // (same name re-uses the existing folder), and writeByPath in always-new
  // mode rejects collisions outright. When an extension is provided, the
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
      const parentPath = buildParentPathFromRowId(parentId);
      if (parentPath === null) {
        message.error(t('workingPanel.resources.tree.parentMissing'));
        return;
      }

      const parentDocumentId = parentId ? (byRowId.get(parentId)?.documentId ?? null) : null;
      const baseName = t('workingPanel.resources.tree.untitledFolder');
      const filename = pickUniqueFilename(parentDocumentId, baseName);
      const targetPath = joinPath(parentPath, filename);

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
          const result = await agentDocumentService.createFolder({ agentId, path: targetPath });
          await mutate();
          return extractRowId(result);
        } catch (error) {
          mutate((prev) => (prev ?? []).filter((doc) => doc.id !== pending.id), {
            revalidate: false,
          });
          message.error(
            error instanceof Error
              ? `${t('workingPanel.resources.tree.createError')}: ${error.message}`
              : t('workingPanel.resources.tree.createError'),
          );
          return null;
        } finally {
          pendingCreatesRef.current.delete(pending.id);
        }
      })();

      pendingCreatesRef.current.set(pending.id, createPromise);
      await createPromise;
    },
    [agentId, buildParentPathFromRowId, byRowId, message, mutate, pickUniqueFilename, t],
  );

  const createDocument = useCallback(
    async (parentId: string | null, opts?: CreateOptions) => {
      const parentPath = buildParentPathFromRowId(parentId);
      if (parentPath === null) {
        message.error(t('workingPanel.resources.tree.parentMissing'));
        return;
      }

      const baseStem = t('workingPanel.resources.tree.untitledDocument');
      const parentDocumentId = parentId ? (byRowId.get(parentId)?.documentId ?? null) : null;
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
          const result =
            parentPath === ROOT_PATH
              ? await agentDocumentService.createDocument({
                  agentId,
                  content: '',
                  title: pendingFilename,
                })
              : await agentDocumentService.writeByPath({
                  agentId,
                  content: '',
                  createMode: 'always-new',
                  path: joinPath(parentPath, pendingFilename),
                });
          await mutate();
          return extractRowId(result);
        } catch (error) {
          mutate((prev) => (prev ?? []).filter((doc) => doc.id !== pending.id), {
            revalidate: false,
          });
          message.error(
            error instanceof Error
              ? `${t('workingPanel.resources.tree.createError')}: ${error.message}`
              : t('workingPanel.resources.tree.createError'),
          );
          return null;
        } finally {
          pendingCreatesRef.current.delete(pending.id);
        }
      })();

      pendingCreatesRef.current.set(pending.id, createPromise);
      await createPromise;
    },
    [agentId, buildParentPathFromRowId, byRowId, message, mutate, pickUniqueFilename, t],
  );

  const renameDocument = useCallback(
    async (id: string, newName: string) => {
      const target = dataRef.current.find((doc) => doc.id === id);
      if (!target) return;
      if (target.category === 'skill') return;

      const trimmed = newName.trim();
      if (!trimmed) {
        message.warning(t('workingPanel.resources.renameEmpty'));
        return;
      }
      if (trimmed === target.title) return;

      // If the row is a pending optimistic insert, wait for the create to
      // resolve so we can rename against the real server-side id. Once the
      // pending row is replaced by the real row (same path) the tree's
      // path-based rename state survives the hydration, so the user's input
      // stays intact.
      if (isPendingId(id)) {
        const pendingPromise = pendingCreatesRef.current.get(id);
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
        message.success(t('workingPanel.resources.renameSuccess'));
      } catch (error) {
        // rollback
        mutate(
          (prev) =>
            (prev ?? []).map((doc) =>
              doc.id === id ? { ...doc, filename: target.filename, title: target.title } : doc,
            ),
          { revalidate: false },
        );
        message.error(
          error instanceof Error ? error.message : t('workingPanel.resources.renameError'),
        );
      }
    },
    [agentId, message, mutate, t],
  );

  const moveDocument: DocumentTreeOps['moveDocument'] = useCallback(
    async ({ sourceIds, sourceNodes, targetId }) => {
      if (sourceIds.length === 0) return;

      const targetParentPath = buildParentPathFromRowId(targetId);
      if (targetParentPath === null) {
        message.error(t('workingPanel.resources.tree.parentMissing'));
        return;
      }

      const targetItem = targetId ? byRowId.get(targetId) : null;
      if (targetItem?.isSkillBundle) return;

      const targetParentDocId = targetItem ? targetItem.documentId : null;

      const moves: Array<{ fromPath: string; id: string; toPath: string }> = [];
      for (const id of sourceIds) {
        const node = sourceNodes.find((n) => n.data?.id === id)?.data;
        if (!node) continue;
        if (node.category === 'skill') return;
        const fromPath = buildItemPath(node);
        if (!fromPath) continue;
        const toPath = joinPath(targetParentPath, node.filename);
        if (fromPath === toPath) continue;
        moves.push({ fromPath, id, toPath });
      }

      if (moves.length === 0) return;

      // Optimistic: reparent each source row to the new parent's documentId.
      const movedIds = new Set(moves.map((m) => m.id));
      mutate(
        (prev) =>
          (prev ?? []).map((doc) =>
            movedIds.has(doc.id) ? { ...doc, parentId: targetParentDocId } : doc,
          ),
        { revalidate: false },
      );

      const errors: Error[] = [];
      for (const move of moves) {
        try {
          await agentDocumentService.moveDocument({
            agentId,
            fromPath: move.fromPath,
            toPath: move.toPath,
          });
        } catch (error) {
          errors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }

      await mutate();

      if (errors.length > 0) {
        const detail = errors.map((e) => e.message).join('; ');
        message.error(`${t('workingPanel.resources.tree.moveError')}: ${detail}`);
      }
    },
    [agentId, buildItemPath, buildParentPathFromRowId, byRowId, message, mutate, t],
  );

  const deleteDocuments = useCallback(
    (ids: string[]) => {
      const uniqueIds = Array.from(new Set(ids));
      const resolved = uniqueIds
        .map((id) => dataRef.current.find((doc) => doc.id === id))
        .filter((doc): doc is AgentDocumentItem => !!doc)
        .filter((doc) => !isProtectedManagedSkillItem(doc, dataRef.current));

      if (resolved.length === 0) return;

      // When a selected folder is an ancestor of another selection, skip the
      // descendant — the folder's recursive delete already covers it.
      const docById = new Map(dataRef.current.map((doc) => [doc.documentId, doc]));
      const folderDocIds = new Set(
        resolved.filter((doc) => doc.isFolder && !doc.isSkillBundle).map((doc) => doc.documentId),
      );
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
          const plans: Array<
            | { kind: 'folder'; path: string; target: AgentDocumentItem }
            | { kind: 'row'; target: AgentDocumentItem }
          > = [];

          for (const target of targets) {
            // Skill bundles are removed via the bundle row, not path-based
            // recursive removal.
            const isFolder = target.isFolder && !target.isSkillBundle;
            if (isFolder) {
              const folderPath = buildItemPath(target);
              if (!folderPath) {
                message.error(t('workingPanel.resources.tree.parentMissing'));
                return;
              }
              plans.push({ kind: 'folder', path: folderPath, target });
            } else {
              plans.push({ kind: 'row', target });
            }
            removedIds.add(target.id);
            if (isFolder) {
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
          }

          const snapshot = dataRef.current;
          mutate((prev) => (prev ?? []).filter((doc) => !removedIds.has(doc.id)), {
            revalidate: false,
          });

          void (async () => {
            const errors: Error[] = [];
            await Promise.all(
              plans.map(async (plan) => {
                try {
                  if (plan.kind === 'folder') {
                    await agentDocumentService.deleteByPath({
                      agentId,
                      path: plan.path,
                      recursive: true,
                    });
                  } else {
                    await agentDocumentService.removeDocument({
                      agentId,
                      documentId: plan.target.documentId,
                      id: plan.target.id,
                      topicId,
                    });
                  }
                } catch (error) {
                  errors.push(error instanceof Error ? error : new Error(String(error)));
                }
              }),
            );

            if (errors.length === plans.length) {
              mutate(snapshot, { revalidate: false });
              const detail = errors.map((e) => e.message).join('; ');
              message.error(`${t('workingPanel.resources.deleteError')}: ${detail}`);
              return;
            }

            await mutate();
            if (errors.length > 0) {
              const detail = errors.map((e) => e.message).join('; ');
              message.error(`${t('workingPanel.resources.deleteError')}: ${detail}`);
            }
          })();
        },
        title:
          targets.length > 1
            ? t('workingPanel.resources.deleteTitleMulti', { count: targets.length })
            : t('workingPanel.resources.deleteTitle'),
      });
    },
    [agentId, buildItemPath, message, mutate, t, topicId],
  );

  return useMemo(
    () => ({
      createDocument,
      createFolder,
      deleteDocuments,
      moveDocument,
      renameDocument,
    }),
    [createDocument, createFolder, deleteDocuments, moveDocument, renameDocument],
  );
};
