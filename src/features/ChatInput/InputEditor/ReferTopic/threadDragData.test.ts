import { THREAD_DRAG_MIME } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { readThreadDragData, writeThreadDragData } from './threadDragData';

describe('threadDragData', () => {
  it('round-trips a thread payload through the custom MIME', () => {
    const dataTransfer = new DataTransfer();
    writeThreadDragData(dataTransfer, {
      sourceMessageId: 'msg-9',
      threadId: 'thread-1',
      threadTitle: 'Side quest',
    });

    expect(dataTransfer.types).toContain(THREAD_DRAG_MIME);
    expect(dataTransfer.effectAllowed).toBe('copy');
    expect(readThreadDragData(dataTransfer)).toEqual({
      sourceMessageId: 'msg-9',
      threadId: 'thread-1',
      threadTitle: 'Side quest',
    });
  });

  it('does not react to unrelated drag data', () => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', 'thread-1');

    expect(readThreadDragData(dataTransfer)).toBeUndefined();
  });

  it('rejects malformed data and payloads without an id', () => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData(THREAD_DRAG_MIME, '{invalid');
    expect(readThreadDragData(dataTransfer)).toBeUndefined();

    dataTransfer.setData(THREAD_DRAG_MIME, JSON.stringify({ threadTitle: 'Missing id' }));
    expect(readThreadDragData(dataTransfer)).toBeUndefined();
  });

  it('leaves sourceMessageId undefined and falls back to an untitled title', () => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData(THREAD_DRAG_MIME, JSON.stringify({ threadId: 'thread-1' }));

    expect(readThreadDragData(dataTransfer)).toEqual({
      sourceMessageId: undefined,
      threadId: 'thread-1',
      threadTitle: 'Untitled',
    });
  });
});
