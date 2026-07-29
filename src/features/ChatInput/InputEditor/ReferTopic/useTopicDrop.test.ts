import { act, renderHook } from '@testing-library/react';
import type { DragEvent } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INSERT_REFER_TOPIC_COMMAND } from './ReferTopicPlugin';
import { writeTopicDragData } from './topicDragData';
import { useTopicDrop } from './useTopicDrop';

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

describe('useTopicDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts the dragged topic reference into the editor', () => {
    const dataTransfer = new DataTransfer();
    writeTopicDragData(dataTransfer, { topicId: 'topic-1', topicTitle: 'Research' });
    const event = createDragEvent(dataTransfer);
    const { result } = renderHook(() => useTopicDrop());

    act(() => result.current.onDrop(event));

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(editor.focus).toHaveBeenCalled();
    expect(editor.dispatchCommand).toHaveBeenCalledWith(INSERT_REFER_TOPIC_COMMAND, {
      topicId: 'topic-1',
      topicTitle: 'Research',
    });
  });

  it('ignores unrelated drag data', () => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', 'plain text');
    const event = createDragEvent(dataTransfer);
    const { result } = renderHook(() => useTopicDrop());

    act(() => result.current.onDrop(event));

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(editor.dispatchCommand).not.toHaveBeenCalled();
  });
});
