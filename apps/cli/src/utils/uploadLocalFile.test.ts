import { describe, expect, it, vi } from 'vitest';

import { uploadFileBuffer } from './uploadLocalFile';

describe('uploadFileBuffer', () => {
  it('stores image dimensions in file metadata for stable evidence layout', async () => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(1600, 16);
    png.writeUInt32BE(900, 20);
    const createFile = vi.fn().mockResolvedValue({ id: 'file-1' });
    const client = {
      file: {
        checkFileHash: { mutate: vi.fn().mockResolvedValue({ isExist: true, url: 'files/x.png' }) },
        createFile: { mutate: createFile },
      },
    } as unknown as Parameters<typeof uploadFileBuffer>[0];

    await uploadFileBuffer(
      client,
      { buffer: png, fileName: 'evidence.png', fileType: 'image/png' },
      {},
    );

    expect(createFile).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ height: 900, width: 1600 }),
      }),
    );
  });
});
