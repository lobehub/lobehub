// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpenAIChatMessage } from '../types';
import { imageUrlToBase64 } from './imageToBase64';
import {
  hasMediaPart,
  hasRemoteImage,
  inlineRemoteImages,
  isMediaFetchError,
  replaceMediaWithPlaceholders,
} from './remoteMediaFallback';

vi.mock('./imageToBase64', () => ({ imageUrlToBase64: vi.fn() }));

const URL_A = 'https://files.example.com/a.png';

const messages: OpenAIChatMessage[] = [
  {
    content: [
      { image_url: { url: URL_A }, type: 'image_url' },
      { image_url: { url: 'data:image/png;base64,AAAA' }, type: 'image_url' },
      { type: 'video_url', video_url: { url: 'https://files.example.com/v.mp4' } },
    ],
    role: 'user',
  },
  { content: [{ image_url: { url: URL_A }, type: 'image_url' }], role: 'tool', tool_call_id: '1' },
  { content: 'plain', role: 'assistant' },
];

describe('remoteMediaFallback', () => {
  beforeEach(() => {
    vi.mocked(imageUrlToBase64).mockReset();
  });

  it.each([
    'failed to download or process media content',
    'Failed To Download Or Process Media Content',
    'error getting file type: failed to download file',
    'Unable to download content from the provided URL before the timeout',
    'Unable to download the file. Please verify the URL and try again.',
  ])('recognizes provider media fetch error: %s', (message) => {
    expect(isMediaFetchError({ error: { error: { message } }, errorType: 'X' })).toBe(true);
  });

  it('ignores other errors', () => {
    expect(isMediaFetchError({ error: { message: 'rate limit exceeded' } })).toBe(false);
    expect(isMediaFetchError(undefined)).toBe(false);
  });

  it('detects remote images and media parts', () => {
    expect(hasRemoteImage(messages)).toBe(true);
    expect(hasMediaPart(messages)).toBe(true);
    const textOnly: OpenAIChatMessage[] = [{ content: 'hi', role: 'user' }];
    expect(hasMediaPart(textOnly)).toBe(false);
    expect(
      hasRemoteImage([
        {
          content: [{ image_url: { url: 'data:image/png;base64,AA' }, type: 'image_url' }],
          role: 'user',
        },
      ]),
    ).toBe(false);
  });

  it('inlines each remote image once and keeps data URIs and videos untouched', async () => {
    vi.mocked(imageUrlToBase64).mockResolvedValue({ base64: 'QUJD', mimeType: 'image/png' });

    const result = await inlineRemoteImages(messages);

    expect(imageUrlToBase64).toHaveBeenCalledTimes(1);
    expect(result[0].content).toEqual([
      { image_url: { url: 'data:image/png;base64,QUJD' }, type: 'image_url' },
      { image_url: { url: 'data:image/png;base64,AAAA' }, type: 'image_url' },
      { type: 'video_url', video_url: { url: 'https://files.example.com/v.mp4' } },
    ]);
    expect(result[1].content).toEqual([
      { image_url: { url: 'data:image/png;base64,QUJD' }, type: 'image_url' },
    ]);
    expect(result[2]).toBe(messages[2]);
  });

  it('turns an image whose download returns a non-image body into a placeholder', async () => {
    vi.mocked(imageUrlToBase64).mockResolvedValue({ base64: 'PGh0bWw+', mimeType: 'text/html' });

    const result = await inlineRemoteImages(messages);

    expect((result[0].content as any[])[0]).toEqual({
      text: `[Image omitted: the model provider could not download or process it. Original URL: ${URL_A}]`,
      type: 'text',
    });
  });

  it('replaces every media part with a text placeholder', async () => {
    const result = await replaceMediaWithPlaceholders(messages);

    expect(result[0].content).toEqual([
      {
        text: `[Image omitted: the model provider could not download or process it. Original URL: ${URL_A}]`,
        type: 'text',
      },
      {
        text: '[Image omitted: the model provider could not download or process it.]',
        type: 'text',
      },
      {
        text: '[Video omitted: the model provider could not download or process it. Original URL: https://files.example.com/v.mp4]',
        type: 'text',
      },
    ]);
    expect(hasMediaPart(result)).toBe(false);
  });
});
