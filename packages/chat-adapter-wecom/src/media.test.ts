import { createCipheriv, randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { collectWeComMedia, downloadWeComMedia } from './media';
import type { WeComMessageBody } from './types';

const encrypt = (plain: Buffer, key: Buffer) => {
  const pad = 32 - (plain.length % 32);
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([
    cipher.update(Buffer.concat([plain, Buffer.alloc(pad, pad)])),
    cipher.final(),
  ]);
};

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('collectWeComMedia', () => {
  it('collects image, file, video and mixed images in order', () => {
    const refs = collectWeComMedia({
      file: { aeskey: 'f', url: 'https://f' },
      image: { aeskey: 'i', url: 'https://i' },
      mixed: {
        msg_item: [
          { msgtype: 'text', text: { content: 'x' } },
          { image: { aeskey: 'm', url: 'https://m' }, msgtype: 'image' },
        ],
      },
      video: { url: 'https://v' },
    } as WeComMessageBody);
    expect(refs.map((r) => [r.kind, r.url])).toEqual([
      ['image', 'https://i'],
      ['file', 'https://f'],
      ['video', 'https://v'],
      ['image', 'https://m'],
    ]);
  });
});

describe('downloadWeComMedia', () => {
  it('downloads, decrypts and sniffs an image', async () => {
    const key = randomBytes(32);
    const fetchImpl = vi.fn(async () => new Response(encrypt(PNG, key)));
    const media = await downloadWeComMedia(
      { aeskey: key.toString('base64'), kind: 'image', url: 'https://img' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(media.buffer.equals(PNG)).toBe(true);
    expect(media.mimeType).toBe('image/png');
  });

  it('takes the file name from Content-Disposition and the MIME type from it', async () => {
    const key = randomBytes(32);
    const fetchImpl = vi.fn(
      async () =>
        new Response(encrypt(Buffer.from('%PDF-1.7'), key), {
          headers: { 'content-disposition': "attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf" },
        }),
    );
    const media = await downloadWeComMedia(
      { aeskey: key.toString('base64'), kind: 'file', url: 'https://file' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(media.name).toBe('报告.pdf');
    expect(media.mimeType).toBe('application/pdf');
  });

  it('throws on a failed download', async () => {
    const fetchImpl = vi.fn(async () => new Response('gone', { status: 403 }));
    await expect(
      downloadWeComMedia({ kind: 'video', url: 'https://v' }, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/403/);
  });
});
