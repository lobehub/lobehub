// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_INLINE_IMAGE_BUDGET } from '../core/contextBuilders/inlineImageBudget';
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

/** A Responses API tool message: the image lives in `responsesOutput`, which is replayed verbatim. */
const toolOutputMessages: OpenAIChatMessage[] = [
  {
    content: 'readFile result',
    responsesOutput: [
      { text: 'readFile result', type: 'input_text' },
      { detail: 'auto', image_url: URL_A, type: 'input_image' },
    ],
    role: 'tool',
    tool_call_id: 'call-1',
  },
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

  it('inlines images carried by a native Responses tool output', async () => {
    vi.mocked(imageUrlToBase64).mockResolvedValue({ base64: 'QUJD', mimeType: 'image/png' });

    const result = await inlineRemoteImages(toolOutputMessages);

    expect(hasRemoteImage(toolOutputMessages)).toBe(true);
    expect(hasMediaPart(toolOutputMessages)).toBe(true);
    expect(result[0].responsesOutput).toEqual([
      { text: 'readFile result', type: 'input_text' },
      { detail: 'auto', image_url: 'data:image/png;base64,QUJD', type: 'input_image' },
    ]);
    // The textual content of the message is untouched.
    expect(result[0].content).toBe('readFile result');
  });

  it('replaces a rejected Responses tool output image with a text placeholder', async () => {
    vi.mocked(imageUrlToBase64).mockRejectedValue(new Error('download failed'));

    const result = await replaceMediaWithPlaceholders(toolOutputMessages);

    expect(result[0].responsesOutput).toEqual([
      { text: 'readFile result', type: 'input_text' },
      {
        text: `[Image omitted: the model provider could not download or process it. Original URL: ${URL_A}]`,
        type: 'input_text',
      },
    ]);
    expect(hasMediaPart(result)).toBe(false);
  });

  it('stops inlining once the aggregate request budget is spent', async () => {
    // 4 MB of base64 per image: five fit the 20 MB budget, the sixth must not be downloaded.
    const base64 = 'A'.repeat(4 * 1024 * 1024);
    vi.mocked(imageUrlToBase64).mockResolvedValue({ base64, mimeType: 'image/png' });

    const many: OpenAIChatMessage[] = Array.from({ length: 6 }, (_, index) => ({
      content: [
        { image_url: { url: `https://files.example.com/${index}.png` }, type: 'image_url' },
      ],
      role: 'user',
    }));

    const result = await inlineRemoteImages(many);

    expect(imageUrlToBase64).toHaveBeenCalledTimes(5);
    expect(result.slice(0, 5).every((message) => (message.content as any[])[0].image_url)).toBe(
      true,
    );
    expect((result[5].content as any[])[0]).toEqual({
      text: '[Image omitted: the model provider could not download or process it. Original URL: https://files.example.com/5.png]',
      type: 'text',
    });
  });

  it('skips a download whose remaining allowance rounds to zero', async () => {
    // Fill the budget down to a single base64 byte: the next binary allowance would be 0,
    // which `imageUrlToBase64` reads as "no limit".
    const { maxTotalBase64Bytes } = DEFAULT_INLINE_IMAGE_BUDGET;
    const prefixLength = 'data:image/png;base64,'.length;
    const perImage = 1024 * 1024;
    const lastLength = maxTotalBase64Bytes - 1 - 3 * (perImage + prefixLength) - prefixLength;

    const lengths = [perImage, perImage, perImage, lastLength, perImage];
    vi.mocked(imageUrlToBase64).mockImplementation(async (url) => {
      const index = Number(new URL(url).pathname.replaceAll(/\D/g, ''));
      return { base64: 'A'.repeat(lengths[index]), mimeType: 'image/png' };
    });

    const many: OpenAIChatMessage[] = Array.from({ length: 5 }, (_, index) => ({
      content: [
        { image_url: { url: `https://files.example.com/${index}.png` }, type: 'image_url' },
      ],
      role: 'user',
    }));

    const result = await inlineRemoteImages(many);

    expect(imageUrlToBase64).toHaveBeenCalledTimes(4);
    expect((result[4].content as any[])[0]).toEqual({
      text: '[Image omitted: the model provider could not download or process it. Original URL: https://files.example.com/4.png]',
      type: 'text',
    });
  });

  it('cancels pending downloads together with the caller', async () => {
    vi.mocked(imageUrlToBase64).mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const controller = new AbortController();
    const pending = inlineRemoteImages(messages, { signal: controller.signal });
    controller.abort();

    const result = await pending;

    expect(imageUrlToBase64).toHaveBeenCalledWith(
      URL_A,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result[0].content).toEqual([
      {
        text: `[Image omitted: the model provider could not download or process it. Original URL: ${URL_A}]`,
        type: 'text',
      },
      { image_url: { url: 'data:image/png;base64,AAAA' }, type: 'image_url' },
      { type: 'video_url', video_url: { url: 'https://files.example.com/v.mp4' } },
    ]);
  });
});
