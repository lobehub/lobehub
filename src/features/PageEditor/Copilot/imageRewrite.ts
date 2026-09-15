import {
  $findNodeById,
  $isHoleNode,
  type CapturedCollaborativeRewriteSelection,
  type IEditor,
} from '@lobehub/editor';
import type { LexicalNode } from 'lexical';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

export interface ImageModelSelection {
  model: string;
  provider: string;
}

const PREFERRED_IMAGE_MODELS: ImageModelSelection[] = [
  { model: 'openai/gpt-image-2', provider: 'zenmux' },
  { model: 'gpt-image-2', provider: 'zenmux' },
  { model: 'gpt-image-2', provider: 'openai' },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isBlockImageRewriteSelection = (selection: unknown): boolean => {
  if (!selection || !isRecord(selection)) return false;
  return selection.targetKind === 'node' && selection.adapterId === 'block-image';
};

export const isBlockImagePlaceholderSelection = (
  selection: CapturedCollaborativeRewriteSelection | Record<string, unknown> | null | undefined,
): boolean =>
  isBlockImageRewriteSelection(selection) &&
  isRecord(selection) &&
  selection.imagePlaceholder === true;

export type BlockImageStatus = 'error' | 'loading' | 'uploaded';

export interface BlockImagePlaceholderState {
  placeholder: boolean;
  src: string;
  status: BlockImageStatus;
}

/** Read the current block-image node; persisted selection metadata is only a draft hint. */
export const getBlockImagePlaceholderState = (
  editor: IEditor | undefined,
  selection: CapturedCollaborativeRewriteSelection | Record<string, unknown> | null | undefined,
): BlockImagePlaceholderState | null => {
  if (!editor || !isBlockImageRewriteSelection(selection) || !isRecord(selection)) return null;
  const nodeId = selection.targetNodeId;
  if (typeof nodeId !== 'string' || !nodeId) return null;
  const lexicalEditor = editor.getLexicalEditor();
  if (!lexicalEditor) return null;

  let state: BlockImagePlaceholderState | null = null;
  lexicalEditor.getEditorState().read(() => {
    const node = $findNodeById(nodeId);
    if (!node || node.getType() !== 'block-image') return;
    const image = node as LexicalNode & { src?: unknown; status?: unknown };
    if (
      typeof image.src !== 'string' ||
      (image.status !== 'uploaded' && image.status !== 'loading' && image.status !== 'error')
    )
      return;
    state = {
      placeholder: !image.src.trim() && (image.status === 'loading' || image.status === 'error'),
      src: image.src,
      status: image.status,
    };
  });
  return state;
};

export const isCurrentBlockImagePlaceholder = (
  editor: IEditor | undefined,
  selection: CapturedCollaborativeRewriteSelection | Record<string, unknown> | null | undefined,
): boolean => getBlockImagePlaceholderState(editor, selection)?.placeholder === true;

export const isEnabledImageModel = (
  enabledList: readonly EnabledProviderWithModels[],
  selection: ImageModelSelection | null | undefined,
): boolean => {
  if (!selection) return false;
  return Boolean(
    enabledList
      .find((provider) => provider.id === selection.provider)
      ?.children.some((model) => model.id === selection.model),
  );
};

export const getDefaultImageModel = (
  enabledList: readonly EnabledProviderWithModels[],
): ImageModelSelection | null => {
  for (const preferred of PREFERRED_IMAGE_MODELS) {
    if (isEnabledImageModel(enabledList, preferred)) return preferred;
  }

  for (const provider of enabledList) {
    const model = provider.children[0];
    if (model) return { model: model.id, provider: provider.id };
  }

  return null;
};

export const removeBlockImagePlaceholder = (
  editor: IEditor | undefined,
  selection: CapturedCollaborativeRewriteSelection | Record<string, unknown> | null | undefined,
): boolean => {
  if (!editor || !isBlockImageRewriteSelection(selection) || !isRecord(selection)) return false;
  if (editor.isEditable && !editor.isEditable()) return false;
  const nodeId = selection.targetNodeId;
  if (typeof nodeId !== 'string' || !nodeId) return false;
  const lexicalEditor = editor.getLexicalEditor();
  if (!lexicalEditor) return false;

  let removed = false;
  lexicalEditor.update(
    () => {
      const node = $findNodeById(nodeId);
      if (!node || node.getType() !== 'block-image') return;
      const image = node as typeof node & { src?: unknown; status?: unknown };
      if (
        (image.status !== 'loading' && image.status !== 'error') ||
        typeof image.src !== 'string' ||
        image.src.trim()
      )
        return;
      const parent = node.getParent();
      if ($isHoleNode(parent) && parent.getContentChildren().length === 1) {
        parent.remove();
      } else {
        node.remove();
      }
      removed = true;
    },
    { discrete: true },
  );
  return removed;
};

export const setBlockImagePlaceholderStatus = (
  editor: IEditor | undefined,
  selection: CapturedCollaborativeRewriteSelection | Record<string, unknown> | null | undefined,
  status: 'error' | 'loading',
): boolean => {
  if (!editor || !isBlockImageRewriteSelection(selection) || !isRecord(selection)) return false;
  if (editor.isEditable && !editor.isEditable()) return false;
  const nodeId = selection.targetNodeId;
  if (typeof nodeId !== 'string' || !nodeId) return false;
  const lexicalEditor = editor.getLexicalEditor();
  if (!lexicalEditor) return false;

  let canUpdate = false;
  lexicalEditor.getEditorState().read(() => {
    const node = $findNodeById(nodeId);
    if (!node || node.getType() !== 'block-image') return;
    const image = node as LexicalNode & { src: string; status: string };
    canUpdate =
      !image.src.trim() &&
      (image.status === 'loading' || image.status === 'error') &&
      image.status !== status;
  });
  if (!canUpdate) return false;

  let updated = false;
  lexicalEditor.update(
    () => {
      const node = $findNodeById(nodeId);
      if (!node || node.getType() !== 'block-image') return;
      const image = node as LexicalNode & {
        setStatus: (status: 'error' | 'loading') => void;
        src: string;
        status: string;
      };
      if (
        image.src.trim() ||
        (image.status !== 'loading' && image.status !== 'error') ||
        image.status === status
      )
        return;
      image.setStatus(status);
      updated = true;
    },
    { discrete: true },
  );
  return updated;
};
