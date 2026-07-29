import { TOPIC_DRAG_MIME } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { readTopicDragData, writeTopicDragData } from './topicDragData';

describe('topicDragData', () => {
  it('round-trips a topic payload through the custom MIME', () => {
    const dataTransfer = new DataTransfer();
    writeTopicDragData(dataTransfer, { topicId: 'topic-1', topicTitle: 'Research' });

    expect(dataTransfer.types).toContain(TOPIC_DRAG_MIME);
    expect(dataTransfer.effectAllowed).toBe('copy');
    expect(readTopicDragData(dataTransfer)).toEqual({
      topicId: 'topic-1',
      topicTitle: 'Research',
    });
  });

  it('does not react to unrelated drag data', () => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', 'topic-1');

    expect(readTopicDragData(dataTransfer)).toBeUndefined();
  });

  it('rejects malformed data and payloads without an id', () => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData(TOPIC_DRAG_MIME, '{invalid');
    expect(readTopicDragData(dataTransfer)).toBeUndefined();

    dataTransfer.setData(TOPIC_DRAG_MIME, JSON.stringify({ topicTitle: 'Missing id' }));
    expect(readTopicDragData(dataTransfer)).toBeUndefined();
  });

  it('uses an untitled fallback when the title is empty', () => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData(TOPIC_DRAG_MIME, JSON.stringify({ topicId: 'topic-1' }));

    expect(readTopicDragData(dataTransfer)).toEqual({
      topicId: 'topic-1',
      topicTitle: 'Untitled',
    });
  });
});
