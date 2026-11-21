import { act, renderHook } from '@testing-library/react';
import type { DragEvent } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { writeDocumentDragData } from './documentDragData';
import { INSERT_REFER_DOCUMENT_COMMAND } from './ReferDocumentPlugin';
import { useDocumentDrop } from './useDocumentDrop';

const editor = vi.hoisted(() => ({
  dispatchCommand: vi.fn(),
  focus: vi.fn(),
}));

vi.mock('../../store', () => ({
  useChatInputStore: (selector: (state: { editor: typeof editor }) => unknown) =>
    selector({ editor }),
}));

const createDragEvent = (dataTransfer: DataTransfer) =>
  ({
    dataTransfer,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }) as unknown as DragEvent;

describe('useDocumentDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts the dragged document reference into the editor', () => {
    const dataTransfer = new DataTransfer();
    writeDocumentDragData(dataTransfer, { documentId: 'doc-1', title: 'Style Guide' });
    const event = createDragEvent(dataTransfer);
    const { result } = renderHook(() => useDocumentDrop());

    act(() => result.current.onDrop(event));

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(editor.focus).toHaveBeenCalled();
    expect(editor.dispatchCommand).toHaveBeenCalledWith(INSERT_REFER_DOCUMENT_COMMAND, {
      documentId: 'doc-1',
      title: 'Style Guide',
    });
  });

  it('ignores unrelated drag data', () => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', 'plain text');
    const event = createDragEvent(dataTransfer);
    const { result } = renderHook(() => useDocumentDrop());

    act(() => result.current.onDrop(event));

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(editor.dispatchCommand).not.toHaveBeenCalled();
  });
});
