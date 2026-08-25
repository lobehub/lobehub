import { createMediaFileRef } from '@lobechat/const/mediaRef';
import { describe, expect, it } from 'vitest';

import {
  buildAnalyzeMediaContent,
  createMediaFileItems,
  createUrlMediaFileItems,
  filterAllowedMediaUrls,
  formatMediaUrlValidationError,
  hasUserMediaFiles,
  MAX_MEDIA_URL_LENGTH,
  MAX_MEDIA_URLS,
  normalizeStringArray,
  selectMediaFileItems,
  validateMediaUrls,
} from './media';

describe('media', () => {
  it('should normalize string array tool arguments', () => {
    expect(normalizeStringArray([' image_1 ', '', 42, 'video_1'])).toEqual(['image_1', 'video_1']);
    expect(normalizeStringArray('image_1')).toEqual([]);
  });

  it('should allow only http, https and media data urls', () => {
    expect(
      filterAllowedMediaUrls([
        'https://example.com/image.png',
        'http://example.com/video.mp4',
        'data:audio/mpeg;base64,abcd',
        'data:image/png;base64,abcd',
        'data:video/mp4;base64,abcd',
        'data:text/plain;base64,abcd',
        'ftp://example.com/image.png',
        'not-a-url',
      ]),
    ).toEqual({
      invalidUrls: ['data:text/plain;base64,abcd', 'ftp://example.com/image.png', 'not-a-url'],
      validUrls: [
        'https://example.com/image.png',
        'http://example.com/video.mp4',
        'data:audio/mpeg;base64,abcd',
        'data:image/png;base64,abcd',
        'data:video/mp4;base64,abcd',
      ],
    });
  });

  it('should reject too many or oversized direct media urls', () => {
    const urls = Array.from(
      { length: MAX_MEDIA_URLS + 1 },
      (_, index) => `https://example.com/image-${index}.png`,
    );
    const tooManyValidation = validateMediaUrls(urls);

    expect(tooManyValidation.tooManyUrls).toBe(true);
    expect(formatMediaUrlValidationError(tooManyValidation)).toContain(
      `At most ${MAX_MEDIA_URLS} URLs are supported`,
    );

    const oversizedUrl = `data:image/png;base64,${'a'.repeat(MAX_MEDIA_URL_LENGTH)}`;
    const oversizedValidation = validateMediaUrls([oversizedUrl]);

    expect(oversizedValidation.oversizedUrls).toEqual([oversizedUrl]);
    expect(formatMediaUrlValidationError(oversizedValidation)).toContain(
      `${MAX_MEDIA_URL_LENGTH} character limit`,
    );
  });

  it('should create media file refs for message attachments', () => {
    const items = createMediaFileItems(
      { id: 'msg-1' },
      [{ alt: 'image.png', id: 'file-image', url: 'https://example.com/image.png' }],
      [{ alt: 'video.mp4', id: 'file-video', url: 'https://example.com/video.mp4' }],
      [{ alt: 'audio.mp3', id: 'file-audio', url: 'https://example.com/audio.mp3' }],
    );

    expect(items).toEqual([
      {
        description: 'image.png',
        id: 'file-image',
        localRef: 'image_1',
        messageId: 'msg-1',
        name: 'image.png',
        ref: createMediaFileRef({ index: 0, messageId: 'msg-1', type: 'image' }),
        type: 'image',
        uri: 'https://example.com/image.png',
      },
      {
        description: 'video.mp4',
        id: 'file-video',
        localRef: 'video_1',
        messageId: 'msg-1',
        name: 'video.mp4',
        ref: createMediaFileRef({ index: 0, messageId: 'msg-1', type: 'video' }),
        type: 'video',
        uri: 'https://example.com/video.mp4',
      },
      {
        description: 'audio.mp3',
        id: 'file-audio',
        localRef: 'audio_1',
        messageId: 'msg-1',
        name: 'audio.mp3',
        ref: createMediaFileRef({ index: 0, messageId: 'msg-1', type: 'audio' }),
        type: 'audio',
        uri: 'https://example.com/audio.mp3',
      },
    ]);
  });

  it('should infer URL item type and name from direct media urls', () => {
    expect(
      createUrlMediaFileItems([
        'https://example.com/path/generated.png',
        'https://example.com/meeting.mp3?download=1',
        'https://example.com/video.webm?download=1',
        'data:audio/wav;base64,abcd',
        'data:video/mp4;base64,abcd',
      ]),
    ).toMatchObject([
      { name: 'generated.png', ref: 'url_1', type: 'image' },
      { name: 'meeting.mp3', ref: 'url_2', type: 'audio' },
      { name: 'video.webm', ref: 'url_3', type: 'video' },
      { name: 'URL 4', ref: 'url_4', type: 'audio' },
      { name: 'URL 5', ref: 'url_5', type: 'video' },
    ]);
  });

  it('should build shared media model content with audio parts', () => {
    const content = buildAnalyzeMediaContent(
      [
        {
          description: 'generated.png',
          localRef: 'url_1',
          name: 'generated.png',
          ref: 'url_1',
          type: 'image',
          uri: 'https://example.com/generated.png',
        },
        {
          description: 'meeting.mp3',
          localRef: 'url_2',
          name: 'meeting.mp3',
          ref: 'url_2',
          type: 'audio',
          uri: 'https://example.com/meeting.mp3',
        },
      ],
      'what is this?',
      { includeFallbackInstruction: true, includeFileSummary: true },
    );

    expect(content).toEqual([
      expect.objectContaining({
        text: expect.stringContaining(
          'Files:\n- url_1: generated.png (image)\n- url_2: meeting.mp3 (audio)',
        ),
        type: 'text',
      }),
      {
        image_url: { detail: 'auto', url: 'https://example.com/generated.png' },
        type: 'image_url',
      },
      {
        audio_url: { url: 'https://example.com/meeting.mp3' },
        type: 'audio_url',
      },
    ]);
  });

  it('should select only stable refs from media messages', () => {
    const currentItems = createMediaFileItems({ id: 'msg-current' }, [
      { alt: 'current.png', id: 'file-current', url: 'https://example.com/current.png' },
    ]);
    const previousItems = createMediaFileItems({ id: 'msg-previous' }, [
      { alt: 'previous.png', id: 'file-previous', url: 'https://example.com/previous.png' },
    ]);
    const previousStableRef = createMediaFileRef({
      index: 0,
      messageId: 'msg-previous',
      type: 'image',
    });
    const currentStableRef = createMediaFileRef({
      index: 0,
      messageId: 'msg-current',
      type: 'image',
    });

    expect(
      selectMediaFileItems(
        [...currentItems, ...previousItems],
        [currentStableRef, previousStableRef, 'image_1', 'missing'],
      ),
    ).toMatchObject({
      availableRefs: [currentStableRef, previousStableRef],
      invalidRefs: ['image_1', 'missing'],
      selected: [currentItems[0], previousItems[0]],
    });
  });

  it('should only treat user messages with media attachments as user media files', () => {
    expect(
      hasUserMediaFiles({
        imageList: [{ id: 'file-image', url: 'https://example.com/image.png' }],
        role: 'user',
      }),
    ).toBe(true);
    expect(
      hasUserMediaFiles({
        audioList: [{ alt: 'audio.mp3', id: 'file-audio', url: 'https://example.com/audio.mp3' }],
        role: 'user',
      }),
    ).toBe(true);
    expect(
      hasUserMediaFiles({
        imageList: [{ id: 'file-image', url: 'https://example.com/image.png' }],
        role: 'assistant',
      }),
    ).toBe(false);
  });
});
