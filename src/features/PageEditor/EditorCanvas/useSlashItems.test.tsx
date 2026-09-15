import { INSERT_BLOCK_IMAGE_COMMAND, INSERT_IMAGE_COMMAND } from '@lobehub/editor';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSlashItems } from './useSlashItems';

const mocks = vi.hoisted(() => ({
  createSelection: vi.fn(),
  openFileSelector: vi.fn(),
}));

vi.mock('@lobehub/editor', () => ({
  INSERT_ARTIFACT_COMMAND: 'insert-artifact',
  INSERT_CHECK_LIST_COMMAND: 'insert-check-list',
  INSERT_CODEMIRROR_COMMAND: 'insert-codemirror',
  INSERT_COLLAPSIBLE_COMMAND: 'insert-collapsible',
  INSERT_HEADING_COMMAND: 'insert-heading',
  INSERT_HORIZONTAL_RULE_COMMAND: 'insert-horizontal-rule',
  INSERT_IMAGE_COMMAND: 'insert-image',
  INSERT_BLOCK_IMAGE_COMMAND: 'insert-block-image',
  INSERT_MATH_COMMAND: 'insert-math',
  INSERT_ORDERED_LIST_COMMAND: 'insert-ordered-list',
  INSERT_TABLE_COMMAND: 'insert-table',
  INSERT_UNORDERED_LIST_COMMAND: 'insert-unordered-list',
}));

vi.mock('./PageRewriteBlockMenuPlugin', () => ({
  createPageRewriteNodeSelection: mocks.createSelection,
}));

vi.mock('@/features/EditorCanvas', () => ({
  openFileSelector: mocks.openFileSelector,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const getInsertItems = (items: ReturnType<typeof useSlashItems>) =>
  items.find((section) => section.type === 'section' && section.key === 'insert')?.items ?? [];

describe('useSlashItems', () => {
  beforeEach(() => {
    mocks.createSelection.mockReset();
    mocks.openFileSelector.mockReset();
  });

  it('inserts a block-image at the active cursor and opens the rewrite target after commit', () => {
    const selection = {
      adapterId: 'block-image',
      imagePlaceholder: true,
      targetKind: 'node',
      targetNodeId: 'image-1',
    };
    mocks.createSelection.mockReturnValue(selection);
    const onRewriteSelection = vi.fn();
    const dispatchCommand = vi.fn();
    const editor = {
      blur: vi.fn(),
      dispatchCommand,
    };
    const { result } = renderHook(() =>
      useSlashItems({ documentId: 'page-1', onRewriteSelection }),
    );
    const item = getInsertItems(result.current).find(
      (candidate) => candidate.key === 'generate-image',
    );

    expect(item).toBeDefined();
    act(() => {
      item?.onSelect(editor as never);
    });

    expect(dispatchCommand).toHaveBeenCalledWith(INSERT_BLOCK_IMAGE_COMMAND, {
      onInserted: expect.any(Function),
    });
    const { onInserted } = dispatchCommand.mock.calls[0]![1] as {
      onInserted: (id: string) => void;
    };
    onInserted('image-1');

    expect(mocks.createSelection).toHaveBeenCalledWith(editor, 'image-1', 'page-1');
    expect(editor.blur).toHaveBeenCalledOnce();
    expect(onRewriteSelection).toHaveBeenCalledWith(selection);
  });

  it('keeps the uploaded-image slash action separate from AI block-image insertion', () => {
    const dispatchCommand = vi.fn();
    const editor = { dispatchCommand };
    const { result } = renderHook(() => useSlashItems());
    const item = getInsertItems(result.current).find((candidate) => candidate.key === 'image');

    expect(item).toBeDefined();
    mocks.openFileSelector.mockImplementation((callback: (files: File[]) => void) =>
      callback([new File(['image'], 'image.png', { type: 'image/png' })]),
    );
    act(() => {
      item?.onSelect(editor as never);
    });

    expect(dispatchCommand).toHaveBeenCalledWith(INSERT_IMAGE_COMMAND, {
      file: expect.any(File),
    });
    expect(dispatchCommand).not.toHaveBeenCalledWith(INSERT_BLOCK_IMAGE_COMMAND, expect.anything());
  });
});
