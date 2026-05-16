import type { MenuProps } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Trash2Icon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { memo, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatch, useNavigate } from 'react-router-dom';
import type { KeyedMutator } from 'swr';

import type {
  ExplorerTreeCanDropCtx,
  ExplorerTreeHandle,
  ExplorerTreeNode,
} from '@/features/ExplorerTree';
import { ExplorerTree, FOLDER_ICON_CSS } from '@/features/ExplorerTree';
import { useChatStore } from '@/store/chat';

import DocumentExplorerToolbar from './DocumentExplorerToolbar';
import { useDocumentTreeOps } from './hooks/useDocumentTreeOps';
import type { AgentDocumentItem } from './types';
import {
  isFolderItem,
  isManagedSkillItem,
  isOrphanSkillBundleItem,
  isSkillIndexItem,
} from './types';
import { canDropDocument } from './utils/canDrop';

const PAGE_ROUTE_PATTERN = '/agent/:aid/:topicId/page/:docId?';
const SKILL_INDEX_FILENAME = 'SKILL.md';

const styles = createStaticStyles(({ css, cssVar }) => ({
  tree: css`
    --trees-bg-override: transparent;
    --trees-border-color-override: transparent;
    --trees-selected-bg-override: ${cssVar.colorFillSecondary};
    --trees-bg-muted-override: ${cssVar.colorFillTertiary};
    --trees-fg-override: ${cssVar.colorText};
    --trees-fg-muted-override: ${cssVar.colorTextSecondary};
    --trees-accent-override: ${cssVar.colorPrimary};
    --trees-padding-inline-override: 0px;
    --trees-font-size-override: 12px;
    --trees-border-radius-override: 6px;
  `,
}));

interface Props {
  agentId: string;
  data: AgentDocumentItem[];
  mutate: KeyedMutator<AgentDocumentItem[]>;
  style?: CSSProperties;
}

const DocumentExplorerTree = memo<Props>(({ agentId, data, mutate, style }) => {
  const { t } = useTranslation(['chat', 'common']);
  const navigate = useNavigate();
  const pageMatch = useMatch(PAGE_ROUTE_PATTERN);
  const openDocument = useChatStore((s) => s.openDocument);
  const treeRef = useRef<ExplorerTreeHandle | null>(null);

  const startInlineRename = useCallback((id: string) => {
    treeRef.current?.startRenaming(id);
  }, []);

  const ops = useDocumentTreeOps({
    agentId,
    data,
    mutate,
    topicId: pageMatch?.params.topicId,
  });

  const documents = useMemo(() => data.filter((doc) => doc.sourceType !== 'web'), [data]);

  // AgentDocument.parentId references the parent's documentId (FK to documents.id),
  // but ExplorerTree's flat layout expects parentId to point at another node's
  // tree-node id (= row id here). Translate via documentId → row id.
  const rowIdByDocumentId = useMemo(() => {
    const map = new Map<string, string>();
    for (const doc of documents) map.set(doc.documentId, doc.id);
    return map;
  }, [documents]);

  const resolveParentRowId = useCallback(
    (parentDocumentId: string | null): string | null => {
      if (!parentDocumentId) return null;
      return rowIdByDocumentId.get(parentDocumentId) ?? null;
    },
    [rowIdByDocumentId],
  );

  const nodes = useMemo<ExplorerTreeNode<AgentDocumentItem>[]>(
    () =>
      documents.map((doc) => ({
        data: doc,
        id: doc.id,
        isFolder: isFolderItem(doc),
        name: isSkillIndexItem(doc) ? SKILL_INDEX_FILENAME : doc.title || doc.filename || '',
        parentId: resolveParentRowId(doc.parentId),
      })),
    [documents, resolveParentRowId],
  );
  const defaultExpandedIds = useMemo(
    () => nodes.filter((node) => node.isFolder && node.parentId == null).map((node) => node.id),
    [nodes],
  );

  const parentMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const doc of documents) map.set(doc.id, resolveParentRowId(doc.parentId));
    return map;
  }, [documents, resolveParentRowId]);

  const isRecoverableSkillBundle = useCallback(
    (doc: AgentDocumentItem) => isOrphanSkillBundleItem(doc, documents),
    [documents],
  );

  const focusNewRowForRename = useCallback((pendingId: string) => {
    // Defer past the current task so React commits the inserted row and the
    // tree adapter rebuilds its id→path map before we trigger rename.
    setTimeout(() => treeRef.current?.startRenaming(pendingId), 0);
  }, []);

  const handleCreateFolder = useCallback(
    (parentId: string | null) =>
      ops.createFolder(parentId, { onPendingInserted: focusNewRowForRename }),
    [focusNewRowForRename, ops],
  );
  const handleCreateDocument = useCallback(
    (parentId: string | null) =>
      ops.createDocument(parentId, { onPendingInserted: focusNewRowForRename }),
    [focusNewRowForRename, ops],
  );

  const handleNodeClick = useCallback(
    (node: ExplorerTreeNode<AgentDocumentItem>) => {
      const doc = node.data;
      if (!doc || node.isFolder) return;
      if (pageMatch?.params.aid && pageMatch.params.topicId) {
        navigate(
          `/agent/${pageMatch.params.aid}/${pageMatch.params.topicId}/page/${doc.documentId}`,
        );
        return;
      }
      openDocument(doc.documentId);
    },
    [navigate, openDocument, pageMatch?.params.aid, pageMatch?.params.topicId],
  );

  const handleCommitRename = useCallback(
    async (node: ExplorerTreeNode<AgentDocumentItem>, newName: string) => {
      await ops.renameDocument(node.id, newName);
    },
    [ops],
  );

  const handleMove = useCallback(
    async (event: {
      newParentId: string | null;
      sourceIds: string[];
      sourceNodes: ExplorerTreeNode<AgentDocumentItem>[];
    }) => {
      await ops.moveDocument({
        sourceIds: event.sourceIds,
        sourceNodes: event.sourceNodes,
        targetId: event.newParentId,
      });
    },
    [ops],
  );

  const canDrag = useCallback(
    (node: ExplorerTreeNode<AgentDocumentItem>) =>
      !!node.data && node.data.sourceType !== 'web' && !isManagedSkillItem(node.data),
    [],
  );

  const canRename = useCallback(
    (node: ExplorerTreeNode<AgentDocumentItem>) =>
      !!node.data && node.data.sourceType !== 'web' && !isManagedSkillItem(node.data),
    [],
  );

  const canDrop = useCallback(
    (ctx: ExplorerTreeCanDropCtx<AgentDocumentItem>) => canDropDocument({ ctx, parentMap }),
    [parentMap],
  );

  const getContextMenuItems = useCallback(
    (node: ExplorerTreeNode<AgentDocumentItem>): MenuProps['items'] => {
      if (node.data && isManagedSkillItem(node.data) && !isRecoverableSkillBundle(node.data)) {
        return [];
      }

      const isFolder = !!node.isFolder;
      const targetParentId = isFolder ? node.id : (node.parentId ?? null);

      const items: NonNullable<MenuProps['items']> = [];

      if (isFolder && (!node.data || !isManagedSkillItem(node.data))) {
        items.push(
          {
            key: 'new-folder',
            label: t('workingPanel.resources.tree.newFolder'),
            onClick: () => handleCreateFolder(targetParentId),
          },
          {
            key: 'new-document',
            label: t('workingPanel.resources.tree.newDocument'),
            onClick: () => handleCreateDocument(targetParentId),
          },
          { key: 'div-1', type: 'divider' },
        );
      }

      if (!node.data || !isManagedSkillItem(node.data)) {
        items.push({
          key: 'rename',
          label: t('workingPanel.resources.tree.rename'),
          onClick: () => startInlineRename(node.id),
        });
      }

      items.push({
        danger: true,
        icon: <Trash2Icon size={14} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: () => ops.deleteDocument(node.id),
      });

      return items;
    },
    [handleCreateDocument, handleCreateFolder, isRecoverableSkillBundle, ops, startInlineRename, t],
  );

  return (
    <div className={styles.tree} style={style}>
      <ExplorerTree<AgentDocumentItem>
        iconsColored
        canDrag={canDrag}
        canDrop={canDrop}
        canRename={canRename}
        defaultExpandedIds={defaultExpandedIds}
        density="compact"
        getContextMenuItems={getContextMenuItems}
        iconSet="complete"
        nodes={nodes}
        ref={treeRef}
        style={{ height: '100%' }}
        unsafeCSS={FOLDER_ICON_CSS}
        header={
          <DocumentExplorerToolbar
            onCreateDocument={() => handleCreateDocument(null)}
            onCreateFolder={() => handleCreateFolder(null)}
          />
        }
        onCommitRename={handleCommitRename}
        onMove={handleMove}
        onNodeClick={handleNodeClick}
      />
    </div>
  );
});

DocumentExplorerTree.displayName = 'DocumentExplorerTree';

export default DocumentExplorerTree;
