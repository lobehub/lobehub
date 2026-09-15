'use client';

import {
  $findNodeById,
  type BlockRewriteContext,
  captureCollaborativeRewriteSelection,
  type CapturedCollaborativeRewriteSelection,
  hashRewriteText,
  type IBlockMenuRenderContext,
  IBlockMenuService,
  IBlockRewriteAdapterService,
  ICollaborativeTargetLeaseService,
  type IEditor,
  resolveRewriteAdapterTarget,
} from '@lobehub/editor';
import {
  $getNodeByKey,
  $isDecoratorNode,
  $isElementNode,
  $isTextNode,
  type LexicalNode,
} from 'lexical';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface PageRewriteBlockMenuPluginProps {
  activeNodeIds?: readonly string[];
  editor?: IEditor;
  onRewriteSelection?: (selection: CapturedCollaborativeRewriteSelection) => void;
  /** The authoritative collaboration room (Page document id), never from DOM. */
  roomId?: string;
}

interface BlockTextBounds {
  endNodeId: string;
  endOffset: number;
  startNodeId: string;
  startOffset: number;
}

const getBlockTextNodes = (node: LexicalNode): LexicalNode[] => {
  if ($isTextNode(node)) return [node];
  if ($isElementNode(node)) return node.getAllTextNodes();
  return [];
};

const getBlockTextBounds = (context: IBlockMenuRenderContext): BlockTextBounds | null => {
  const lexicalEditor = context.editor.getLexicalEditor();
  if (!lexicalEditor) return null;

  let bounds: BlockTextBounds | null = null;
  lexicalEditor.getEditorState().read(() => {
    const node = $getNodeByKey(context.blockId);
    if (!node || $isDecoratorNode(node)) return;

    const textNodes = getBlockTextNodes(node).filter(
      (textNode) => textNode.getTextContent().length > 0,
    );
    const first = textNodes[0];
    const last = textNodes.at(-1);
    if (!first || !last || node.getTextContent().trim().length === 0) return;

    bounds = {
      endNodeId: last.getKey(),
      endOffset: last.getTextContentSize(),
      startNodeId: first.getKey(),
      startOffset: 0,
    };
  });

  return bounds;
};

const getBlockRewriteContext = (context: IBlockMenuRenderContext): BlockRewriteContext | null => {
  const lexicalEditor = context.editor.getLexicalEditor();
  if (!lexicalEditor) return null;

  let rewriteContext: BlockRewriteContext | null = null;
  lexicalEditor.getEditorState().read(() => {
    const candidate = $getNodeByKey(context.blockId);
    if (!candidate) return;
    const service = context.editor.requireService(IBlockRewriteAdapterService);
    const resolved = resolveRewriteAdapterTarget(candidate, service);
    const resolvedContext = resolved?.context;
    const leaseService = context.editor.requireService(ICollaborativeTargetLeaseService);
    rewriteContext =
      resolved?.adapter.capabilities.canEdit &&
      resolvedContext?.sourceHash &&
      (!leaseService ||
        leaseService.can({ nodeId: resolvedContext.nodeId, targetKind: 'node' }, 'edit'))
        ? resolvedContext
        : null;
  });
  return rewriteContext;
};

/** Build a durable node target after an editor command has committed. */
export const createPageRewriteNodeSelection = (
  editor: IEditor,
  nodeId: string,
  roomId: string,
): CapturedCollaborativeRewriteSelection | null => {
  const lexicalEditor = editor.getLexicalEditor();
  if (!lexicalEditor || !nodeId || !roomId) return null;

  let selection: CapturedCollaborativeRewriteSelection | null = null;
  lexicalEditor.getEditorState().read(() => {
    const node = $findNodeById(nodeId);
    const service = editor.requireService(IBlockRewriteAdapterService);
    const resolved = node ? resolveRewriteAdapterTarget(node, service) : null;
    const context = resolved?.context;
    if (!context || context.nodeId !== nodeId || !context.sourceHash) return;

    selection = {
      adapterId: context.adapterKey,
      endNodeId: context.nodeId,
      endOffset: 1,
      kind: 'block',
      quotedText: context.summary || context.title || context.nodeType,
      quotedTextHash: hashRewriteText(context.source || context.summary || ''),
      roomId,
      sourceHash: context.sourceHash,
      ...(context.image?.placeholder ? { imagePlaceholder: true } : {}),
      startNodeId: context.nodeId,
      startOffset: 0,
      targetKind: 'node',
      targetNodeId: context.nodeId,
      targetNodeIds: [context.nodeId],
    } as unknown as CapturedCollaborativeRewriteSelection;
  });

  return selection;
};

export const canRewritePageBlock = (
  context: IBlockMenuRenderContext,
  activeNodeIds: readonly string[] = [],
): boolean => {
  if (!context.editor.isEditable()) return false;
  const nodeContext = getBlockRewriteContext(context);
  if (nodeContext) return !activeNodeIds.includes(nodeContext.nodeId);
  return Boolean(getBlockTextBounds(context));
};

export const capturePageRewriteBlockSelection = async (
  context: IBlockMenuRenderContext,
  roomId?: string,
): Promise<CapturedCollaborativeRewriteSelection | null> => {
  const nodeContext = getBlockRewriteContext(context);
  if (nodeContext) {
    if (!roomId) return null;
    const nodeSelection = {
      adapterId: nodeContext.adapterKey,
      endNodeId: nodeContext.nodeId,
      endOffset: 1,
      kind: 'block' as const,
      quotedText: nodeContext.summary || nodeContext.title || nodeContext.nodeType,
      quotedTextHash: hashRewriteText(nodeContext.source || nodeContext.summary || ''),
      roomId,
      startNodeId: nodeContext.nodeId,
      startOffset: 0,
      targetKind: 'node' as const,
      targetNodeId: nodeContext.nodeId,
      targetNodeIds: [nodeContext.nodeId],
      sourceHash: nodeContext.sourceHash,
      ...(nodeContext.image?.placeholder ? { imagePlaceholder: true } : {}),
    } as unknown as CapturedCollaborativeRewriteSelection;
    return nodeSelection;
  }

  const bounds = getBlockTextBounds(context);
  if (!bounds) return null;

  try {
    const selected = await context.editor.setSelection({ ...bounds, type: 'range' });
    if (!selected) return null;
    return roomId
      ? captureCollaborativeRewriteSelection(context.editor, { roomId })
      : captureCollaborativeRewriteSelection(context.editor);
  } catch {
    return null;
  }
};

export const handlePageRewriteBlockMenuClick = (
  context: IBlockMenuRenderContext,
  onRewriteSelection: (selection: CapturedCollaborativeRewriteSelection) => void,
  roomId?: string,
): void => {
  void capturePageRewriteBlockSelection(context, roomId).then((selection) => {
    if (!selection) return;

    // Adapter-owned node rewrites do not call setSelection while capturing,
    // so the previous native text selection can otherwise remain visible as
    // the composer opens. IEditor.blur() is the shared Lexical helper that
    // clears both editor focus and the browser selection.
    if ('targetKind' in selection && selection.targetKind === 'node') context.editor.blur?.();
    onRewriteSelection(selection);
  });
};

const PageRewriteBlockMenuPlugin = memo<PageRewriteBlockMenuPluginProps>(
  ({ activeNodeIds = [], editor, onRewriteSelection, roomId }) => {
    const { t } = useTranslation('editor');

    useEffect(() => {
      if (!editor || !onRewriteSelection) return;

      let disposed = false;
      let menuRegistered = false;
      let unregisterMenu: (() => void) | undefined;
      let markedRoot: HTMLElement | null = null;

      const markCurrentRoot = (): void => {
        const root = editor.getRootElement?.();
        if (!root || disposed) return;
        if (
          markedRoot &&
          markedRoot !== root &&
          markedRoot.getAttribute('data-page-rewrite-block-menu') === 'registered'
        ) {
          markedRoot.removeAttribute('data-page-rewrite-block-menu');
        }
        markedRoot = root;
        root.setAttribute('data-page-rewrite-block-menu', 'registered');
      };

      const tryRegister = (): void => {
        if (disposed) return;

        let blockMenuService: IBlockMenuService | null = null;
        try {
          blockMenuService = editor.requireService(IBlockMenuService);
        } catch {
          // A plugin may still be registering its service during the first
          // React effect. The initialized event retries this exact operation.
        }
        if (!blockMenuService) return;

        if (!menuRegistered) {
          unregisterMenu = blockMenuService.registerMenu({
            key: 'page-rewrite-block',
            label: (context) =>
              getBlockRewriteContext(context)?.adapterKey === 'block-image'
                ? t('copilot.rewrite.imageToolbar')
                : t('copilot.rewrite.toolbar'),
            onClick: (context) =>
              handlePageRewriteBlockMenuClick(context, onRewriteSelection, roomId),
            order: 998.75,
            when: (context) => canRewritePageBlock(context, activeNodeIds),
          });
          menuRegistered = true;
        }
        markCurrentRoot();
      };

      const handleInitialized = (): void => {
        tryRegister();
      };

      // Subscribe before the immediate attempt so initialization cannot race
      // this effect. Repeated initialized events are harmless because the
      // menu registration is guarded by `menuRegistered`.
      editor.on('initialized', handleInitialized);
      tryRegister();

      return () => {
        disposed = true;
        editor.off('initialized', handleInitialized);
        unregisterMenu?.();
        unregisterMenu = undefined;
        menuRegistered = false;
        if (markedRoot?.getAttribute('data-page-rewrite-block-menu') === 'registered') {
          markedRoot.removeAttribute('data-page-rewrite-block-menu');
        }
        markedRoot = null;
      };
    }, [activeNodeIds, editor, onRewriteSelection, roomId, t]);

    return null;
  },
);

PageRewriteBlockMenuPlugin.displayName = 'PageRewriteBlockMenuPlugin';

export default PageRewriteBlockMenuPlugin;
