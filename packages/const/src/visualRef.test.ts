import { describe, expect, it } from 'vitest';

import { createVisualFileRef, createVisualLocalRef, createVisualMessageRef } from './visualRef';

describe('visualRef', () => {
  it('should create local refs for current-message visual files', () => {
    expect(createVisualLocalRef('image', 0)).toBe('image_1');
    expect(createVisualLocalRef('video', 1)).toBe('video_2');

    expect(createVisualFileRef({ index: 0, type: 'image' })).toBe('image_1');
    expect(createVisualFileRef({ index: 1, type: 'video' })).toBe('video_2');
  });

  it('should create stable message-scoped refs without exposing raw message ids', () => {
    const messageId = 'msg_real_database_id';
    const messageRef = createVisualMessageRef(messageId);

    expect(messageRef).toMatch(/^msg_[a-z0-9]+$/);
    expect(messageRef).not.toContain(messageId);
    expect(createVisualMessageRef(messageId)).toBe(messageRef);
    expect(createVisualFileRef({ index: 0, messageId, type: 'image' })).toBe(
      `${messageRef}.image_1`,
    );
  });
});
