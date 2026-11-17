import { describe, expect, it, vi } from 'vitest';

import { contentBlocksToMarkdown, uploadMediaBlocks } from './content';

const png = Buffer.from('image-bytes').toString('base64');

describe('uploadMediaBlocks', () => {
  it('replaces media bytes with the key the host stored them under', async () => {
    const upload = vi.fn(async ({ path }: { path: string }) => `stored/${path}`);

    const [image, text] = await uploadMediaBlocks(
      [
        { data: png, mimeType: 'image/png; charset=binary', type: 'image' },
        { text: 'caption', type: 'text' },
      ],
      upload,
    );

    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        base64: png,
        buffer: Buffer.from('image-bytes'),
        mimeType: 'image/png',
        path: expect.stringMatching(/^mcp\/images\/\d{4}-\d{2}-\d{2}\/[\da-f-]+\.png$/),
      }),
    );
    expect(image).toMatchObject({
      data: expect.stringMatching(/^stored\/mcp\/images\//),
      type: 'image',
    });
    expect(text).toEqual({ text: 'caption', type: 'text' });
  });

  it('turns media the host cannot store into a note instead of failing the call', async () => {
    const blocks = await uploadMediaBlocks(
      [
        { data: png, mimeType: 'image/png', type: 'image' },
        { resource: { blob: png, mimeType: 'audio/mpeg', uri: 'file://a.mp3' }, type: 'resource' },
      ],
      async () => undefined,
    );

    expect(blocks).toEqual([
      { text: expect.stringContaining('an image (image/png)'), type: 'text' },
      { text: expect.stringContaining('audio (audio/mpeg)'), type: 'text' },
    ]);
    await expect(contentBlocksToMarkdown(blocks, async (key) => key)).resolves.toContain(
      'could not upload',
    );
  });
});
