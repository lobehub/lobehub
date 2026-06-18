import { AGENT_DOCUMENT_CATEGORY } from '@lobechat/const';
import type { MenuProps } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Maximize2Icon, Trash2Icon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { memo, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { KeyedMutator } from 'swr';

import { buildAgentDocumentPath } from '@/features/AgentDocumentPage/navigation';
import type {
  ExplorerTreeCanDropCtx,
  ExplorerTreeHandle,
  ExplorerTreeNode,
} from '@/features/ExplorerTree';
import {
  ExplorerTree,
  FOLDER_ICON_CSS,
  getExplorerTreeStyleVars,
  HIDE_POINTER_FOCUS_RING_CSS,
} from '@/features/ExplorerTree';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import DocumentExplorerToolbar from './DocumentExplorerToolbar';
import { useDocumentTreeOps } from './hooks/useDocumentTreeOps';
import type { AgentDocumentItem } from './types';
import { isOrphanSkillBundleItem } from './types';
import { canDropDocument } from './utils/canDrop';

const SKILL_INDEX_FILENAME = 'SKILL.md';
const FILE_TREE_HOST_TAG = 'file-tree-container';
const RENAME_INPUT_SELECTOR = 'input[data-item-rename-input]';
const DOCUMENT_TREE_UNSAFE_CSS = `${FOLDER_ICON_CSS}\n${HIDE_POINTER_FOCUS_RING_CSS}`;

// pierre/trees auto-selects the full value when the rename input mounts. For
// files with extensions (e.g. `Untitled document.md`), narrow the selection to
// the stem so the user can type a new name without overwriting the suffix.
const selectStemOfActiveRenameInput = (root: HTMLElement | null) => {
  if (!root) return;
  const host = root.querySelector(FILE_TREE_HOST_TAG);
  const input = host?.shadowRoot?.querySelector<HTMLInputElement>(RENAME_INPUT_SELECTOR);
  if (!input) return;
  const value = input.value;
  const dotIndex = value.lastIndexOf('.');
  // Skip dotfiles and extension-less names — leave pierre's full-selection.
  if (dotIndex <= 0) return;
  input.setSelectionRange(0, dotIndex);
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  tree: css`
    --trees-bg-override: transparent;
    --trees-border-color-override: transparent;
    --trees-selected-bg-override: ${cssVar.colorFillSecondary};
    --trees-selected-fg-override: ${cssVar.colorText};
    --trees-bg-muted-override: ${cssVar.colorFillTertiary};
    --trees-fg-override: ${cssVar.colorTextSecondary};
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
  onOpenDocument?: (documentId: string, agentDocumentId?: string) => void;
  style?: CSSProperties;
}

const DocumentExplorerTree = memo<Props>(({ agentId, data, mutate, onOpenDocument, style }) => {
  const { t } = useTranslation(['chat', 'common']);
  const navigate = useWorkspaceAwareNavigate();
  const treeRef = useRef<ExplorerTreeHandle | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const startInlineRename = useCallback((id: string) => {
    treeRef.current?.startRenaming(id);
    // Match the new-file flow: leave the extension out of the selection so
    // the user can retype only the stem.
    requestAnimationFrame(() => selectStemOfActiveRenameInput(containerRef.current));
  }, []);

  const ops = useDocumentTreeOps({ agentId, data, mutate });

  const documents = useMemo(() => data.filter((doc) => doc.category !== 'web'), [data]);

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
        isFolder: doc.isFolder,
        name: doc.isSkillIndex ? SKILL_INDEX_FILENAME : doc.title || doc.filename || '',
        parentId: resolveParentRowId(doc.parentId),
      })),
    [documents, resolveParentRowId],
  );
  const defaultExpandedIds = useMemo(
    () => nodes.filter((node) => node.isFolder && node.parentId == null).map((node) => node.id),
    [nodes],
  );
  const treeStyleVars = useMemo(
    () => getExplorerTreeStyleVars({ reserveChevronSlot: nodes.some((node) => node.isFolder) }),
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
    setTimeout(() => {
      treeRef.current?.startRenaming(pendingId);
      // After pierre's input.select() runs in its own layout effect, narrow
      // selection to the stem so the `.md` extension stays intact.
      requestAnimationFrame(() => selectStemOfActiveRenameInput(containerRef.current));
    }, 0);
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
      if (onOpenDocument) {
        onOpenDocument(doc.documentId, doc.id);
        return;
      }
      navigate(buildAgentDocumentPath(agentId, doc.documentId));
    },
    [agentId, navigate, onOpenDocument],
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
      !!node.data && node.data.category === AGENT_DOCUMENT_CATEGORY,
    [],
  );

  const canRename = useCallback(
    (node: ExplorerTreeNode<AgentDocumentItem>) =>
      !!node.data && node.data.category === AGENT_DOCUMENT_CATEGORY,
    [],
  );

  const canDrop = useCallback(
    (ctx: ExplorerTreeCanDropCtx<AgentDocumentItem>) => canDropDocument({ ctx, parentMap }),
    [parentMap],
  );

  const getContextMenuItems = useCallback(
    (node: ExplorerTreeNode<AgentDocumentItem>): MenuProps['items'] => {
      const isSkill = node.data?.category === 'skill';
      if (isSkill && !isRecoverableSkillBundle(node.data!)) {
        return [];
      }

      const isFolder = !!node.isFolder;
      const targetParentId = isFolder ? node.id : (node.parentId ?? null);

      // Right-click on a row that's part of the current multi-selection acts
      // on the whole selection; otherwise it targets only the right-clicked
      // row (which matches typical file-tree UX where right-clicking outside
      // the selection narrows the action).
      const selectedIds = treeRef.current?.getSelectedIds() ?? [];
      const isMulti = selectedIds.length > 1 && selectedIds.includes(node.id);
      const deleteIds = isMulti ? selectedIds : [node.id];

      const items: NonNullable<MenuProps['items']> = [];

      if (isFolder && !isSkill && !isMulti) {
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

      if (!isSkill && !isMulti) {
        items.push({
          key: 'rename',
          label: t('workingPanel.resources.tree.rename'),
          onClick: () => startInlineRename(node.id),
        });
      }

      // A document file (not a folder, skill, or multi-select) can be expanded
      // into the full-page document route — the standalone view agent links open.
      if (!isFolder && !isSkill && !isMulti && node.data?.documentId) {
        items.push({
          icon: <Maximize2Icon size={14} />,
          key: 'open-as-page',
          label: t('agentDocument.openAsPage'),
          onClick: () => navigate(buildAgentDocumentPath(agentId, node.data!.documentId)),
        });
      }

      items.push({
        danger: true,
        icon: <Trash2Icon size={14} />,
        key: 'delete',
        label: isMulti
          ? t('workingPanel.resources.tree.deleteSelected', { count: deleteIds.length })
          : t('delete', { ns: 'common' }),
        onClick: () => ops.deleteDocuments(deleteIds),
      });

      return items;
    },
    [
      agentId,
      handleCreateDocument,
      handleCreateFolder,
      isRecoverableSkillBundle,
      navigate,
      ops,
      startInlineRename,
      t,
    ],
  );

  return (
    <div className={styles.tree} ref={containerRef} style={{ ...style, ...treeStyleVars }}>
      <ExplorerTree<AgentDocumentItem>
        iconsColored
        canDrag={canDrag}
        canDrop={canDrop}
        canRename={canRename}
        defaultExpandedIds={defaultExpandedIds}
        getContextMenuItems={getContextMenuItems}
        iconSet="complete"
        nodes={nodes}
        ref={treeRef}
        style={{ height: '100%' }}
        unsafeCSS={DOCUMENT_TREE_UNSAFE_CSS}
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
