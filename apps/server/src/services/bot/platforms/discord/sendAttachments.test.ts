// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  batchDiscordFiles,
  DISCORD_MAX_ATTACHMENTS_PER_MESSAGE,
  materializeAttachmentsForDiscord,
} from './sendAttachments';

describe('materializeAttachmentsForDiscord', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('decodes base64 data into a Buffer with the explicit filename', async () => {
    const files = await materializeAttachmentsForDiscord([
      {
        data: Buffer.from('hello').toString('base64'),
        mimeType: 'image/png',
        name: 'foo.png',
        type: 'image',
      },
    ]);

    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('foo.png');
    expect(files[0].contentType).toBe('image/png');
    expect(Buffer.isBuffer(files[0].data)).toBe(true);
    expect((files[0].data as Buffer).toString()).toBe('hello');
  });

  it('fetches fetchUrl attachments and materializes their bytes', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { 'Content-Type': 'image/png' },
        status: 200,
      }) as any,
    );

    const files = await materializeAttachmentsForDiscord([
      { fetchUrl: 'https://cdn.example.com/pic.png', type: 'image' },
    ]);

    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/pic.png', expect.any(Object));
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('pic.png');
  });

  it('skips attachments that fail to materialize but keeps the rest', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }) as any);

    const files = await materializeAttachmentsForDiscord([
      { fetchUrl: 'https://cdn.example.com/broken.png', type: 'image' },
      { data: Buffer.from('ok').toString('base64'), name: 'ok.txt', type: 'file' },
    ]);

    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('ok.txt');
  });

  it('falls back to a generic filename when name is missing', async () => {
    const files = await materializeAttachmentsForDiscord([
      { data: Buffer.from('a').toString('base64'), mimeType: 'image/png', type: 'image' },
      { data: Buffer.from('b').toString('base64'), mimeType: 'application/pdf', type: 'file' },
    ]);

    expect(files[0].name).toBe('attachment-1.png');
    expect(files[1].name).toBe('attachment-2.pdf');
  });
});

describe('batchDiscordFiles', () => {
  const file = (name: string) => ({ data: Buffer.from('x'), name });

  it('returns empty array for empty input', () => {
    expect(batchDiscordFiles([])).toEqual([]);
  });

  it('keeps a single batch when files <= cap', () => {
    const files = Array.from({ length: DISCORD_MAX_ATTACHMENTS_PER_MESSAGE }, (_, i) =>
      file(`f${i}.png`),
    );
    const batches = batchDiscordFiles(files);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(DISCORD_MAX_ATTACHMENTS_PER_MESSAGE);
  });

  it('splits when files exceed the cap', () => {
    const files = Array.from({ length: DISCORD_MAX_ATTACHMENTS_PER_MESSAGE + 3 }, (_, i) =>
      file(`f${i}.png`),
    );
    const batches = batchDiscordFiles(files);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(DISCORD_MAX_ATTACHMENTS_PER_MESSAGE);
    expect(batches[1]).toHaveLength(3);
  });
});
