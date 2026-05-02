import { createVisualFileRef } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  createUrlVisualFileItems,
  createVisualFileItems,
  filterAllowedVisualMediaUrls,
  hasUserVisualFiles,
  normalizeStringArray,
  selectVisualFileItems,
} from './visualMedia';

describe('visualMedia', () => {
  it('should normalize string array tool arguments', () => {
    expect(normalizeStringArray([' image_1 ', '', 42, 'video_1'])).toEqual(['image_1', 'video_1']);
    expect(normalizeStringArray('image_1')).toEqual([]);
  });

  it('should allow only http, https and data visual media urls', () => {
    expect(
      filterAllowedVisualMediaUrls([
        'https://example.com/image.png',
        'http://example.com/video.mp4',
        'data:image/png;base64,abcd',
        'file:///private/image.png',
        'ftp://example.com/image.png',
        'not-a-url',
      ]),
    ).toEqual({
      invalidUrls: ['file:///private/image.png', 'ftp://example.com/image.png', 'not-a-url'],
      validUrls: [
        'https://example.com/image.png',
        'http://example.com/video.mp4',
        'data:image/png;base64,abcd',
      ],
    });
  });

  it('should create visual file refs for message attachments', () => {
    const items = createVisualFileItems(
      { id: 'msg-1' },
      [{ alt: 'image.png', id: 'file-image', url: 'https://example.com/image.png' }],
      [{ alt: 'video.mp4', id: 'file-video', url: 'https://example.com/video.mp4' }],
    );

    expect(items).toEqual([
      {
        description: 'image.png',
        id: 'file-image',
        localRef: 'image_1',
        messageId: 'msg-1',
        name: 'image.png',
        ref: createVisualFileRef({ index: 0, messageId: 'msg-1', type: 'image' }),
        type: 'image',
        uri: 'https://example.com/image.png',
      },
      {
        description: 'video.mp4',
        id: 'file-video',
        localRef: 'video_1',
        messageId: 'msg-1',
        name: 'video.mp4',
        ref: createVisualFileRef({ index: 0, messageId: 'msg-1', type: 'video' }),
        type: 'video',
        uri: 'https://example.com/video.mp4',
      },
    ]);
  });

  it('should infer URL item type and name from direct media urls', () => {
    expect(
      createUrlVisualFileItems([
        'https://example.com/path/generated.png',
        'https://example.com/video.webm?download=1',
        'data:video/mp4;base64,abcd',
      ]),
    ).toMatchObject([
      { name: 'generated.png', ref: 'url_1', type: 'image' },
      { name: 'video.webm', ref: 'url_2', type: 'video' },
      { name: 'URL 3', ref: 'url_3', type: 'video' },
    ]);
  });

  it('should select stable refs from history and local refs only from the source message', () => {
    const currentItems = createVisualFileItems({ id: 'msg-current' }, [
      { alt: 'current.png', id: 'file-current', url: 'https://example.com/current.png' },
    ]);
    const previousItems = createVisualFileItems({ id: 'msg-previous' }, [
      { alt: 'previous.png', id: 'file-previous', url: 'https://example.com/previous.png' },
    ]);
    const previousStableRef = createVisualFileRef({
      index: 0,
      messageId: 'msg-previous',
      type: 'image',
    });

    expect(
      selectVisualFileItems([...currentItems, ...previousItems], 'msg-current', [
        'image_1',
        previousStableRef,
        'missing',
      ]),
    ).toMatchObject({
      availableRefs: [currentItems[0].ref, 'image_1', previousStableRef],
      invalidRefs: ['missing'],
      selected: [currentItems[0], previousItems[0]],
    });
  });

  it('should only treat user messages with visual attachments as user visual files', () => {
    expect(
      hasUserVisualFiles({
        imageList: [{ id: 'file-image', url: 'https://example.com/image.png' }],
        role: 'user',
      }),
    ).toBe(true);
    expect(
      hasUserVisualFiles({
        imageList: [{ id: 'file-image', url: 'https://example.com/image.png' }],
        role: 'assistant',
      }),
    ).toBe(false);
  });
});
