import type { IEditor } from '@lobehub/editor';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { insertLocalPathTags } from './insertLocalFileTags';

const {
  dispatchCommandMock,
  focusMock,
  isRangeSelectionMock,
  selectEndMock,
  selectionRef,
  updateMock,
} = vi.hoisted(() => ({
  dispatchCommandMock: vi.fn(),
  focusMock: vi.fn(),
  isRangeSelectionMock: vi.fn(),
  selectEndMock: vi.fn(),
  selectionRef: { current: null as unknown },
  updateMock: vi.fn((fn: () => void) => fn()),
}));

vi.mock('lexical', () => ({
  $getRoot: () => ({ selectEnd: selectEndMock }),
  $getSelection: () => selectionRef.current,
  $isRangeSelection: isRangeSelectionMock,
}));

vi.mock('./LocalFileTag', () => ({
  INSERT_LOCAL_FILE_TAG_COMMAND: 'insert-local-file-tag',
}));

const createEditor = () =>
  ({
    dispatchCommand: dispatchCommandMock,
    getLexicalEditor: () => ({
      focus: focusMock,
      update: updateMock,
    }),
  }) as unknown as IEditor;

describe('insertLocalPathTags', () => {
  beforeEach(() => {
    dispatchCommandMock.mockClear();
    focusMock.mockClear();
    isRangeSelectionMock.mockReset();
    selectEndMock.mockClear();
    selectionRef.current = null;
    updateMock.mockClear();
  });

  it('moves the cursor to the end when there is no range selection', () => {
    isRangeSelectionMock.mockReturnValue(false);

    insertLocalPathTags(createEditor(), [
      { isDirectory: false, name: 'image.png', path: '/repo/image.png' },
      { isDirectory: true, name: 'docs', path: '/repo/docs' },
    ]);

    expect(focusMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(selectEndMock).toHaveBeenCalledTimes(1);
    expect(dispatchCommandMock).toHaveBeenNthCalledWith(1, 'insert-local-file-tag', {
      isDirectory: false,
      name: 'image.png',
      path: '/repo/image.png',
    });
    expect(dispatchCommandMock).toHaveBeenNthCalledWith(2, 'insert-local-file-tag', {
      isDirectory: true,
      name: 'docs',
      path: '/repo/docs',
    });
  });

  it('keeps the current selection when it is already a range selection', () => {
    selectionRef.current = {};
    isRangeSelectionMock.mockReturnValue(true);

    insertLocalPathTags(createEditor(), [
      { isDirectory: false, name: 'readme.md', path: '/repo/readme.md' },
    ]);

    expect(selectEndMock).not.toHaveBeenCalled();
    expect(dispatchCommandMock).toHaveBeenCalledWith('insert-local-file-tag', {
      isDirectory: false,
      name: 'readme.md',
      path: '/repo/readme.md',
    });
  });

  it('does nothing for an empty path list', () => {
    insertLocalPathTags(createEditor(), []);

    expect(focusMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(dispatchCommandMock).not.toHaveBeenCalled();
  });
});
