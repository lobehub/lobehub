import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { KeyedMutator } from 'swr';

import { agentDocumentService } from '@/services/agentDocument';

import { type AgentDocumentItem, FOLDER_FILE_TYPE } from '../types';

interface UseDocumentTreeOpsArgs {
  agentId: string;
  data: AgentDocumentItem[];
  mutate: KeyedMutator<AgentDocumentItem[]>;
  topicId?: string;
}

const ROOT_PATH = './';

const joinPath = (parentPath: string, segment: string) =>
  parentPath === ROOT_PATH ? `${ROOT_PATH}${segment}` : `${parentPath}/${segment}`;

export interface DocumentTreeOps {
  createDocument: (parentId: string | null) => Promise<void>;
  createFolder: (parentId: string | null) => Promise<void>;
  deleteDocument: (id: string) => void;
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
      return buildItemPath(parent);
    },
    [byRowId, buildItemPath],
  );

  // Picks a unique filename within the given parent. Used for client-side
  // dedup of "Untitled" rows because the path-based VFS mkdir is idempotent
  // (same name re-uses the existing folder), and writeByPath in always-new
  // mode rejects collisions outright.
  const pickUniqueFilename = useCallback(
    (parentDocumentId: string | null, baseName: string): string => {
      const siblings = dataRef.current.filter((doc) => (doc.parentId ?? null) === parentDocumentId);
      const taken = new Set(siblings.map((doc) => doc.filename));
      if (!taken.has(baseName)) return baseName;
      for (let i = 2; i < 1000; i += 1) {
        const candidate = `${baseName} ${i}`;
        if (!taken.has(candidate)) return candidate;
      }
      return `${baseName} ${Date.now()}`;
    },
    [],
  );

  const createFolder = useCallback(
    async (parentId: string | null) => {
      const parentPath = buildParentPathFromRowId(parentId);
      if (parentPath === null) {
        message.error(t('workingPanel.resources.tree.parentMissing'));
        return;
      }

      const parentDocumentId = parentId ? (byRowId.get(parentId)?.documentId ?? null) : null;
      const baseName = t('workingPanel.resources.tree.untitledFolder');
      const filename = pickUniqueFilename(parentDocumentId, baseName);
      const targetPath = joinPath(parentPath, filename);

      try {
        await agentDocumentService.createFolder({ agentId, path: targetPath });
        await mutate();
      } catch (error) {
        message.error(
          error instanceof Error
            ? `${t('workingPanel.resources.tree.createError')}: ${error.message}`
            : t('workingPanel.resources.tree.createError'),
        );
      }
    },
    [agentId, buildParentPathFromRowId, byRowId, message, mutate, pickUniqueFilename, t],
  );

  const createDocument = useCallback(
    async (parentId: string | null) => {
      const parentPath = buildParentPathFromRowId(parentId);
      if (parentPath === null) {
        message.error(t('workingPanel.resources.tree.parentMissing'));
        return;
      }

      const baseName = t('workingPanel.resources.tree.untitledDocument');

      try {
        if (parentPath === ROOT_PATH) {
          // Server's createDocument auto-deduplicates filenames at the root.
          await agentDocumentService.createDocument({
            agentId,
            content: '',
            title: baseName,
          });
        } else {
          const parentDocumentId = parentId ? (byRowId.get(parentId)?.documentId ?? null) : null;
          const filename = pickUniqueFilename(parentDocumentId, baseName);
          await agentDocumentService.writeByPath({
            agentId,
            content: '',
            createMode: 'always-new',
            path: joinPath(parentPath, filename),
          });
        }
        await mutate();
      } catch (error) {
        message.error(
          error instanceof Error
            ? `${t('workingPanel.resources.tree.createError')}: ${error.message}`
            : t('workingPanel.resources.tree.createError'),
        );
      }
    },
    [agentId, buildParentPathFromRowId, byRowId, message, mutate, pickUniqueFilename, t],
  );

  const renameDocument = useCallback(
    async (id: string, newName: string) => {
      const target = dataRef.current.find((doc) => doc.id === id);
      if (!target) return;

      const trimmed = newName.trim();
      if (!trimmed) {
        message.warning(t('workingPanel.resources.renameEmpty'));
        return;
      }
      if (trimmed === target.title) return;

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
      const targetParentDocId = targetItem ? targetItem.documentId : null;

      const moves: Array<{ fromPath: string; id: string; toPath: string }> = [];
      for (const id of sourceIds) {
        const node = sourceNodes.find((n) => n.data?.id === id)?.data;
        if (!node) continue;
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

  const deleteDocument = useCallback(
    (id: string) => {
      const target = dataRef.current.find((doc) => doc.id === id);
      if (!target) return;

      confirmModal({
        content: t('workingPanel.resources.deleteConfirm'),
        okButtonProps: { danger: true },
        okText: t('delete', { ns: 'common' }),
        onOk: async () => {
          try {
            const isFolder = target.fileType === FOLDER_FILE_TYPE;
            if (isFolder) {
              const path = buildItemPath(target);
              if (path === null) {
                throw new Error(t('workingPanel.resources.tree.parentMissing'));
              }
              await agentDocumentService.deleteByPath({
                agentId,
                path,
                recursive: true,
              });
            } else {
              await agentDocumentService.removeDocument({
                agentId,
                documentId: target.documentId,
                id: target.id,
                topicId,
              });
            }
            await mutate();
            message.success(t('workingPanel.resources.deleteSuccess'));
          } catch (error) {
            message.error(
              error instanceof Error ? error.message : t('workingPanel.resources.deleteError'),
            );
          }
        },
        title: t('workingPanel.resources.deleteTitle'),
      });
    },
    [agentId, buildItemPath, message, mutate, t, topicId],
  );

  return useMemo(
    () => ({
      createDocument,
      createFolder,
      deleteDocument,
      moveDocument,
      renameDocument,
    }),
    [createDocument, createFolder, deleteDocument, moveDocument, renameDocument],
  );
};
