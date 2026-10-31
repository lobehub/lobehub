import { AGENT_DOCUMENT_CATEGORY } from '@lobechat/const';
import { Center, Empty, Flexbox, Icon } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  FilePlusIcon,
  FileTextIcon,
  FileUpIcon,
  FolderPlusIcon,
  Maximize2Icon,
  PenLineIcon,
  Trash2Icon,
} from 'lucide-react';
import type { ChangeEvent, CSSProperties, MouseEvent } from 'react';
import { memo, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { buildAgentDocumentPath } from '@/features/AgentDocumentPage/navigation';
import type {
  ExplorerTreeCanDropCtx,
  ExplorerTreeHandle,
  ExplorerTreeNode,
} from '@/features/ExplorerTree';
import {
  DISABLE_ROW_TEXT_SELECTION_CSS,
  DOCUMENT_TREE_ICON_CSS,
  DOCUMENT_TREE_LAYOUT,
  DOCUMENT_TREE_PARENT_DOCUMENT_GLYPH_CSS,
  DOCUMENT_TREE_ROW_CSS,
  ExplorerTree,
  getExplorerTreeStyleVars,
  HIDE_POINTER_FOCUS_RING_CSS,
  isItemToggleEventPath,
} from '@/features/ExplorerTree';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { NativeContextMenuItem } from '@/libs/contextMenu/types';
import { agentDocumentService } from '@/services/agentDocument';
import { useGlobalStore } from '@/store/global';
import type { AgentDocumentSort } from '@/store/global/initialState';
import { systemStatusSelectors } from '@/store/global/selectors';
import { sx } from '@/styles/sx';

import { openConvertToSkillModal, slugifySkillName } from './ConvertToSkillModal';
import DocumentExplorerToolbar from './DocumentExplorerToolbar';
import { useDocumentTreeOps } from './hooks/useDocumentTreeOps';
import type { AgentDocumentItem, AgentDocumentListMutator } from './types';
import { isOrphanSkillBundleItem } from './types';
import { canDropDocument } from './utils/canDrop';
import { createDocumentComparator } from './utils/sortDocuments';

const SKILL_INDEX_FILENAME = 'SKILL.md';
const FILE_TREE_HOST_TAG = 'file-tree-container';
const RENAME_INPUT_SELECTOR = 'input[data-item-rename-input]';

const DOCUMENT_TREE_UNSAFE_CSS = [
  DOCUMENT_TREE_ICON_CSS,
  DOCUMENT_TREE_ROW_CSS,
  HIDE_POINTER_FOCUS_RING_CSS,
  DISABLE_ROW_TEXT_SELECTION_CSS,
].join('\n');

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

const styles = stylex.create({
  tree: {
    '--trees-bg-override': 'transparent',
    '--trees-border-color-override': 'transparent',
    '--trees-selected-bg-override': cssVar.colorFillSecondary,
    '--trees-selected-fg-override': cssVar.colorText,
    '--trees-bg-muted-override': cssVar.colorFillTertiary,

    // Every row is a document the user can open, so labels keep the primary
    // text color; only the glyphs step back. Mirrors the sidebar NavItem, which
    // pairs colorText titles with colorTextDescription icons.
    '--trees-fg-override': cssVar.colorText,
    '--trees-fg-muted-override': cssVar.colorTextDescription,
    '--trees-accent-override': cssVar.colorPrimary,

    // Nesting reads from indentation alone — no indent guides.
    '--trees-indent-guide-bg-override': 'transparent',

    // Documents are prose, not code: give rows the breathing room of a
    // Notion / 语雀 outline instead of the IDE density the Files tree wants.
    // Row height and label size match the sidebar NavItem (36px / 14px). The
    // font size, level gap and row gap come from DOCUMENT_TREE_LAYOUT (inline).

    // No horizontal gutter of its own: a row's hover fill spans the panel's
    // content edges, the same edges as the panel tabs (技能 / 文档) above. Rows
    // pad their start (DOCUMENT_TREE_ROW_CSS) so the first glyph — file icon or
    // chevron — lines up with the 「文档」 title.
    '--trees-item-padding-x-override': '6px',
    '--trees-item-margin-x-override': '0px',
    '--trees-padding-inline-override': '0px',
    '--trees-border-radius-override': '8px',

    // Consumed by DOCUMENT_TREE_ICON_CSS inside the shadow root.
    '--explorer-tree-icon-fg': cssVar.colorTextDescription,
  },
});

// Layout tokens shared with the document tree's CSS constants, so they stay
// runtime values rather than literals in the stylesheet.
const TREE_LAYOUT_VARS = {
  '--trees-font-size-override': `${DOCUMENT_TREE_LAYOUT.fontSize}px`,
  '--trees-item-row-gap-override': `${DOCUMENT_TREE_LAYOUT.iconGap}px`,
  '--trees-level-gap-override': `${DOCUMENT_TREE_LAYOUT.levelGap}px`,
} as CSSProperties;

interface Props {
  agentId: string;
  data: AgentDocumentItem[];
  mutate: AgentDocumentListMutator;
  onOpenDocument?: (documentId: string, agentDocumentId?: string) => void;
  style?: CSSProperties;
}

const DocumentExplorerTree = memo<Props>(({ agentId, data, mutate, onOpenDocument, style }) => {
  const { t } = useTranslation(['chat', 'common']);
  const navigate = useWorkspaceAwareNavigate();
  const treeRef = useRef<ExplorerTreeHandle | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const folderUploadInputRef = useRef<HTMLInputElement | null>(null);
  const folderUploadParentIdRef = useRef<string | null>(null);

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

  const resolveNodeName = useCallback(
    (doc: AgentDocumentItem): string => {
      if (doc.isSkillIndex) return SKILL_INDEX_FILENAME;
      // Never let an empty name through: a blank segment collides with its
      // parent's path inside the tree's path store and crashes the whole panel
      // (see ExplorerTree/adapter/normalize.ts). Fall back to a localized label.
      return (
        doc.title ||
        doc.filename ||
        t(
          doc.isFolder
            ? 'workingPanel.resources.tree.untitledFolder'
            : 'workingPanel.resources.tree.untitledDocument',
        )
      );
    },
    [t],
  );

  // A plain document can be a parent too (a workflow with its run records
  // nested under it). The tree only lets containers hold children, so such a
  // document becomes a container drawn as a document.
  const parentDocumentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const doc of documents) if (doc.parentId) ids.add(doc.parentId);
    return ids;
  }, [documents]);

  const nodes = useMemo<ExplorerTreeNode<AgentDocumentItem>[]>(
    () =>
      documents.map((doc) => {
        const isParentDocument = !doc.isFolder && parentDocumentIds.has(doc.documentId);
        return {
          ...(isParentDocument && { appearance: 'file' as const }),
          data: doc,
          id: doc.id,
          isFolder: doc.isFolder || isParentDocument,
          name: resolveNodeName(doc),
          parentId: resolveParentRowId(doc.parentId),
        };
      }),
    [documents, parentDocumentIds, resolveNodeName, resolveParentRowId],
  );

  const sort = useGlobalStore(systemStatusSelectors.agentDocumentSort);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const handleSortChange = useCallback(
    (agentDocumentSort: AgentDocumentSort) => updateSystemStatus({ agentDocumentSort }),
    [updateSystemStatus],
  );
  const compareNodes = useMemo(() => createDocumentComparator(sort), [sort]);

  const treeStyleVars = useMemo(
    () =>
      getExplorerTreeStyleVars({
        iconWidth: DOCUMENT_TREE_LAYOUT.iconWidth,
        reserveChevronSlot: nodes.some((node) => node.isFolder),
        rowGap: DOCUMENT_TREE_LAYOUT.iconGap,
      }),
    [nodes],
  );

  const treeStyle = useMemo(
    () => ({ ...TREE_LAYOUT_VARS, ...style, ...treeStyleVars }),
    [style, treeStyleVars],
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
  const openFolderFilePicker = useCallback((parentId: string | null) => {
    folderUploadParentIdRef.current = parentId;
    folderUploadInputRef.current?.click();
  }, []);
  const handleFolderUploadChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      const parentId = folderUploadParentIdRef.current;
      event.target.value = '';
      if (files.length === 0) return;
      void ops.uploadFiles(parentId, files);
    },
    [ops],
  );

  const handleConvertToSkill = useCallback(
    (doc: AgentDocumentItem) => {
      const fallbackTitle = doc.title || doc.filename || '';
      openConvertToSkillModal({
        defaultDescription: doc.description ?? '',
        defaultName: slugifySkillName(fallbackTitle),
        defaultTitle: fallbackTitle,
        generateCacheKey: ['document-to-skill-meta', agentId, doc.id],
        onGenerate: async () => {
          const meta = await agentDocumentService.generateSkillMeta({
            agentId,
            sourceAgentDocumentId: doc.id,
          });
          return meta ?? undefined;
        },
        onSubmit: async ({ name, description, title, generation }) => {
          try {
            await agentDocumentService.convertDocumentToSkill({
              agentId,
              description,
              name,
              sourceAgentDocumentId: doc.id,
              title,
            });
            // Record implicit feedback: saving the generated values unchanged is
            // a positive signal, editing them is negative. Best-effort.
            if (generation) {
              void agentDocumentService.recordSkillMetaFeedback({
                data: {
                  editedFields: generation.editedFields,
                  final: { description, name, title },
                  generated: generation.generated,
                },
                edited: generation.edited,
                tracingId: generation.tracingId,
              });
            }
            await mutate();
            return undefined;
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        },
      });
    },
    [agentId, mutate],
  );

  const handleNodeClick = useCallback(
    (node: ExplorerTreeNode<AgentDocumentItem>, event: MouseEvent<HTMLElement>) => {
      const doc = node.data;
      // A parent document is a container in the tree but still opens on click.
      if (!doc || doc.isFolder) return;
      // Its chevron only expands or collapses; the title opens the document.
      if (node.appearance === 'file' && isItemToggleEventPath(event.nativeEvent.composedPath())) {
        return;
      }
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
    (node: ExplorerTreeNode<AgentDocumentItem>): NativeContextMenuItem[] => {
      const isSkill = node.data?.category === 'skill';
      if (isSkill && !isRecoverableSkillBundle(node.data!)) {
        return [];
      }

      // `node.isFolder` also covers a document holding nested documents; menu
      // entries that depend on the row being a real folder read the data flag.
      const isFolder = !!node.data?.isFolder;
      const targetParentId = isFolder ? node.id : (node.parentId ?? null);
      const isPlainDocument =
        !isFolder && !isSkill && node.data?.category === AGENT_DOCUMENT_CATEGORY;

      // Right-click on a row that's part of the current multi-selection acts
      // on the whole selection; otherwise it targets only the right-clicked
      // row (which matches typical file-tree UX where right-clicking outside
      // the selection narrows the action).
      const selectedIds = treeRef.current?.getSelectedIds() ?? [];
      const isMulti = selectedIds.length > 1 && selectedIds.includes(node.id);
      const deleteIds = isMulti ? selectedIds : [node.id];

      const items: NativeContextMenuItem[] = [];

      if (isFolder && !isSkill && !isMulti) {
        items.push(
          {
            icon: <FolderPlusIcon size={14} />,
            key: 'new-folder',
            label: t('workingPanel.resources.tree.newFolder'),
            onClick: () => handleCreateFolder(targetParentId),
            sfSymbol: 'folder.badge.plus',
          },
          {
            icon: <FilePlusIcon size={14} />,
            key: 'new-document',
            label: t('workingPanel.resources.tree.newDocument'),
            onClick: () => handleCreateDocument(targetParentId),
            sfSymbol: 'doc.badge.plus',
          },
          {
            icon: <FileUpIcon size={14} />,
            key: 'upload-file',
            label: t('workingPanel.resources.tree.uploadFile'),
            onClick: () => openFolderFilePicker(targetParentId),
            sfSymbol: 'square.and.arrow.up',
          },
          { key: 'div-1', type: 'divider' },
        );
      }

      // Any document can hold sub-documents and folders, e.g. the run records
      // of a workflow grouped under it.
      if (isPlainDocument && !isMulti) {
        items.push(
          {
            icon: <FilePlusIcon size={14} />,
            key: 'new-sub-document',
            label: t('workingPanel.resources.tree.newSubDocument'),
            onClick: () => handleCreateDocument(node.id),
            sfSymbol: 'doc.badge.plus',
          },
          {
            icon: <FolderPlusIcon size={14} />,
            key: 'new-sub-folder',
            label: t('workingPanel.resources.tree.newFolder'),
            onClick: () => handleCreateFolder(node.id),
            sfSymbol: 'folder.badge.plus',
          },
          { key: 'div-sub', type: 'divider' },
        );
      }

      if (!isSkill && !isMulti) {
        items.push({
          icon: <PenLineIcon size={14} />,
          key: 'rename',
          label: t('workingPanel.resources.tree.rename'),
          onClick: () => startInlineRename(node.id),
          sfSymbol: 'pencil',
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
          sfSymbol: 'arrow.up.left.and.arrow.down.right',
        });
      }

      // Only plain agent documents (not folders, web sources, or existing
      // skills) can be migrated into a managed skill.
      const isConvertibleToSkill =
        !isFolder &&
        !isSkill &&
        !node.data?.fileId &&
        node.data?.sourceType !== 'file' &&
        node.data?.category === AGENT_DOCUMENT_CATEGORY;
      if (isConvertibleToSkill && !isMulti) {
        items.push({
          icon: <Icon icon={SkillsIcon} size={14} />,
          key: 'convert-to-skill',
          label: t('workingPanel.resources.tree.convertToSkill'),
          onClick: () => handleConvertToSkill(node.data!),
          sfSymbol: 'sparkles',
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
        sfSymbol: 'trash',
      });

      return items;
    },
    [
      agentId,
      handleConvertToSkill,
      handleCreateDocument,
      handleCreateFolder,
      isRecoverableSkillBundle,
      openFolderFilePicker,
      navigate,
      ops,
      startInlineRename,
      t,
    ],
  );

  const toolbar = (
    <DocumentExplorerToolbar
      sort={sort}
      onCreateDocument={() => handleCreateDocument(null)}
      onCreateFolder={() => handleCreateFolder(null)}
      onSortChange={handleSortChange}
      onUploadFiles={(files) => void ops.uploadFiles(null, files)}
    />
  );

  return (
    <div {...sx([styles.tree], undefined, treeStyle)} ref={containerRef}>
      <input
        hidden
        multiple
        ref={folderUploadInputRef}
        type={'file'}
        onChange={handleFolderUploadChange}
      />
      {nodes.length === 0 ? (
        // Keep the toolbar reachable (new folder / new doc) above the placeholder.
        <Flexbox height={'100%'}>
          {toolbar}
          <Center flex={1} paddingBlock={24}>
            <Empty description={t('workingPanel.resources.emptyDocuments')} icon={FileTextIcon} />
          </Center>
        </Flexbox>
      ) : (
        <ExplorerTree<AgentDocumentItem>
          iconsColored
          canDrag={canDrag}
          canDrop={canDrop}
          canRename={canRename}
          fileAppearanceCSS={DOCUMENT_TREE_PARENT_DOCUMENT_GLYPH_CSS}
          flattenEmptyDirectories={false}
          getContextMenuItems={getContextMenuItems}
          header={toolbar}
          iconSet="complete"
          itemHeight={DOCUMENT_TREE_LAYOUT.itemHeight}
          nodes={nodes}
          ref={treeRef}
          sort={compareNodes}
          style={{ height: '100%' }}
          unsafeCSS={DOCUMENT_TREE_UNSAFE_CSS}
          onCommitRename={handleCommitRename}
          onMove={handleMove}
          onNodeClick={handleNodeClick}
        />
      )}
    </div>
  );
});

DocumentExplorerTree.displayName = 'DocumentExplorerTree';

export default DocumentExplorerTree;
