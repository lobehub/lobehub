import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getBlockImagePlaceholderState,
  getDefaultImageModel,
  isBlockImagePlaceholderSelection,
  isBlockImageRewriteSelection,
  isEnabledImageModel,
  removeBlockImagePlaceholder,
  setBlockImagePlaceholderStatus,
} from './imageRewrite';

const mocks = vi.hoisted(() => ({
  findNodeById: vi.fn(),
}));

vi.mock('@lobehub/editor', () => ({
  $findNodeById: mocks.findNodeById,
  $isHoleNode: (node: { getType?: () => string } | null | undefined) =>
    node?.getType?.() === 'hole',
}));

const enabledImageModels = [
  {
    children: [{ abilities: {}, id: 'openai/gpt-image-2', displayName: 'GPT Image 2' }],
    id: 'zenmux',
    name: 'ZenMux',
    source: 'builtin' as const,
  },
  {
    children: [{ abilities: {}, id: 'gpt-image-1' }],
    id: 'openai',
    name: 'OpenAI',
    source: 'builtin' as const,
  },
];

const imageSelection = {
  adapterId: 'block-image',
  imagePlaceholder: true,
  targetKind: 'node',
  targetNodeId: 'image-1',
};

describe('imageRewrite', () => {
  beforeEach(() => {
    mocks.findNodeById.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers the configured ZenMux GPT Image 2 model without changing chat defaults', () => {
    expect(getDefaultImageModel(enabledImageModels)).toEqual({
      model: 'openai/gpt-image-2',
      provider: 'zenmux',
    });
    expect(
      isEnabledImageModel(
        enabledImageModels,
        enabledImageModels[0] && {
          model: 'openai/gpt-image-2',
          provider: 'zenmux',
        },
      ),
    ).toBe(true);
  });

  it('falls back to the first enabled image model and reports an empty configuration', () => {
    expect(
      getDefaultImageModel([
        {
          children: [{ abilities: {}, id: 'custom-image' }],
          id: 'custom',
          name: 'Custom',
          source: 'custom',
        },
      ]),
    ).toEqual({ model: 'custom-image', provider: 'custom' });
    expect(getDefaultImageModel([])).toBeNull();
  });

  it('recognizes only node targets owned by the block-image adapter', () => {
    expect(isBlockImageRewriteSelection(imageSelection)).toBe(true);
    expect(isBlockImageRewriteSelection({ ...imageSelection, adapterId: 'image' })).toBe(false);
    expect(isBlockImageRewriteSelection({ ...imageSelection, targetKind: 'range' })).toBe(false);
    expect(isBlockImagePlaceholderSelection(imageSelection)).toBe(true);
    expect(isBlockImagePlaceholderSelection({ ...imageSelection, imagePlaceholder: false })).toBe(
      false,
    );
  });

  it('removes an empty error placeholder but leaves uploaded images untouched', () => {
    const remove = vi.fn();
    const image = {
      getParent: () => ({
        getContentChildren: () => [image],
        getType: () => 'hole',
        remove,
      }),
      getType: () => 'block-image',
      remove,
      src: '',
      status: 'error',
    };
    mocks.findNodeById.mockReturnValue(image);
    const editor = {
      getLexicalEditor: () => ({
        update: (callback: () => void) => callback(),
      }),
    };
    const normalizedSelection = {
      adapterId: 'block-image',
      targetKind: 'node',
      targetNodeId: 'image-1',
    };

    expect(removeBlockImagePlaceholder(editor as never, normalizedSelection)).toBe(true);
    expect(remove).toHaveBeenCalledOnce();

    image.status = 'uploaded';
    expect(removeBlockImagePlaceholder(editor as never, normalizedSelection)).toBe(false);
    expect(remove).toHaveBeenCalledOnce();

    image.status = 'error';
    image.src = 'https://cdn.example/image.png';
    expect(removeBlockImagePlaceholder(editor as never, normalizedSelection)).toBe(false);
    expect(remove).toHaveBeenCalledOnce();
  });

  it('derives placeholder state from the current block-image node after selection normalization', () => {
    const image = {
      getType: () => 'block-image',
      src: '',
      status: 'loading',
    };
    mocks.findNodeById.mockReturnValue(image);
    const editor = {
      getLexicalEditor: () => ({
        getEditorState: () => ({ read: (callback: () => void) => callback() }),
      }),
    };
    const normalizedSelection = {
      adapterId: 'block-image',
      targetKind: 'node',
      targetNodeId: 'image-1',
    };

    expect(getBlockImagePlaceholderState(editor as never, normalizedSelection)).toEqual({
      placeholder: true,
      src: '',
      status: 'loading',
    });
  });

  it('does not write placeholder state while the editor is read-only or when status is unchanged', () => {
    const setStatus = vi.fn();
    const image = {
      getType: () => 'block-image',
      setStatus,
      src: '',
      status: 'loading',
    };
    mocks.findNodeById.mockReturnValue(image);
    const update = vi.fn((callback: () => void) => callback());
    const read = (callback: () => void) => callback();
    const readOnlyEditor = {
      getLexicalEditor: () => ({ getEditorState: () => ({ read }), update }),
      isEditable: () => false,
    };
    const editableEditor = {
      getLexicalEditor: () => ({ getEditorState: () => ({ read }), update }),
      isEditable: () => true,
    };

    expect(removeBlockImagePlaceholder(readOnlyEditor as never, imageSelection)).toBe(false);
    expect(setBlockImagePlaceholderStatus(readOnlyEditor as never, imageSelection, 'error')).toBe(
      false,
    );
    expect(update).not.toHaveBeenCalled();

    expect(setBlockImagePlaceholderStatus(editableEditor as never, imageSelection, 'loading')).toBe(
      false,
    );
    expect(update).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
  });
});
