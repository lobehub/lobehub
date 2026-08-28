import { describe, expect, it } from 'vitest';

import { createMediaFileRef, createMediaLocalRef, createMediaMessageRef } from './mediaRef';

describe('mediaRef', () => {
  it('should create local refs for current-message visual files', () => {
    expect(createMediaLocalRef('image', 0)).toBe('image_1');
    expect(createMediaLocalRef('video', 1)).toBe('video_2');
    expect(createMediaLocalRef('audio', 2)).toBe('audio_3');

    expect(createMediaFileRef({ index: 0, type: 'image' })).toBe('image_1');
    expect(createMediaFileRef({ index: 1, type: 'video' })).toBe('video_2');
    expect(createMediaFileRef({ index: 2, type: 'audio' })).toBe('audio_3');
  });

  it('should create stable message-scoped refs without exposing raw message ids', () => {
    const messageId = 'msg_real_database_id';
    const messageRef = createMediaMessageRef(messageId);

    expect(messageRef).toMatch(/^msg_[a-z0-9]+$/);
    expect(messageRef).not.toContain(messageId);
    expect(createMediaMessageRef(messageId)).toBe(messageRef);
    expect(createMediaFileRef({ index: 0, messageId, type: 'image' })).toBe(
      `${messageRef}.image_1`,
    );
  });
});
