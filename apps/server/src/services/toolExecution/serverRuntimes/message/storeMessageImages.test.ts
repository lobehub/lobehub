// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMessageImageStore, MAX_MESSAGE_IMAGE_BYTES } from './storeMessageImages';

const uploadFromBuffer = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: fetchMock }));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return { uploadFromBuffer };
  }),
}));

vi.mock('../resolveWorkspaceScope', () => ({
  resolveContentWorkspaceId: vi.fn().mockResolvedValue('ws_1'),
}));

const candidate = (overrides: Record<string, unknown> = {}) => ({
  mediaType: 'image/png',
  messageId: '1564834535558881420',
  name: 'image.png',
  size: 1000,
  url: 'https://cdn.discordapp.com/attachments/1/2/image.png?ex=1',
  ...overrides,
});

const pngResponse = (bytes = 1000, contentType = 'image/png') =>
  new Response(new Uint8Array(bytes), {
    headers: { 'content-length': String(bytes), 'content-type': contentType },
  });

const store = createMessageImageStore({ serverDB: {} as any, userId: 'user_1' });

describe('createMessageImageStore', () => {
  beforeEach(() => {
    uploadFromBuffer.mockResolvedValue({ fileId: 'file_1', key: 'k', url: 'https://app/f/file_1' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('copies a Discord image into file storage and returns the durable URL', async () => {
    fetchMock.mockResolvedValue(pngResponse());

    const images = await store([candidate()]);

    expect(images).toEqual([
      {
        fileId: 'file_1',
        mediaType: 'image/png',
        messageId: '1564834535558881420',
        name: 'image.png',
        url: 'https://app/f/file_1',
      },
    ]);
    const [buffer, mediaType, pathname] = uploadFromBuffer.mock.calls[0];
    expect(buffer.length).toBe(1000);
    expect(mediaType).toBe('image/png');
    expect(pathname).toMatch(
      /^files\/\d{4}-\d{2}-\d{2}\/im-1564834535558881420-[\da-f]{12}-image\.png$/,
    );
  });

  it('never fetches hosts off the allowlist', async () => {
    const images = await store([
      candidate({ url: 'https://files.slack.com/private/a.png' }),
      candidate({ url: 'http://cdn.discordapp.com/a.png' }),
      candidate({ url: 'https://169.254.169.254/latest' }),
    ]);

    expect(images).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips images over the size limit, by declared size or by body', async () => {
    fetchMock.mockResolvedValue(pngResponse(MAX_MESSAGE_IMAGE_BYTES + 1));

    const images = await store([
      candidate({ size: MAX_MESSAGE_IMAGE_BYTES + 1 }),
      candidate({ name: 'b.png', size: undefined }),
    ]);

    expect(images).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(uploadFromBuffer).not.toHaveBeenCalled();
  });

  it('skips a body whose type is not the image the platform announced', async () => {
    fetchMock.mockResolvedValue(pngResponse(1000, 'text/html'));

    expect(await store([candidate()])).toEqual([]);
  });

  it('keeps the images that worked when another one fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(pngResponse());

    const images = await store([candidate({ name: 'a.png' }), candidate({ name: 'b.png' })]);

    expect(images.map((image) => image.name)).toEqual(['b.png']);
  });

  it('gives two attachments with the same file name different object keys', async () => {
    fetchMock.mockImplementation(async () => pngResponse());

    await store([
      candidate({ url: 'https://cdn.discordapp.com/attachments/1/111/image.png' }),
      candidate({ url: 'https://cdn.discordapp.com/attachments/1/222/image.png' }),
    ]);

    const keys = uploadFromBuffer.mock.calls.map((call) => call[2]);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });
});
