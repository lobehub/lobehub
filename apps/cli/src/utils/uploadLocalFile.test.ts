import { afterEach, describe, expect, it, vi } from 'vitest';

import { uploadFileBuffer } from './uploadLocalFile';

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it('releases a reservation when durable file creation fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const abortS3Upload = vi.fn().mockResolvedValue({ success: true });
    const client = {
      file: {
        checkFileHash: { mutate: vi.fn().mockResolvedValue({ isExist: false }) },
        createFile: { mutate: vi.fn().mockRejectedValue(new Error('create failed')) },
      },
      upload: {
        abortS3Upload: { mutate: abortS3Upload },
        createS3PreSignedUrl: { mutate: vi.fn().mockResolvedValue('https://s3/presigned') },
      },
    } as unknown as Parameters<typeof uploadFileBuffer>[0];

    await expect(
      uploadFileBuffer(client, {
        buffer: Buffer.from('file'),
        fileName: 'file.txt',
        fileType: 'text/plain',
      }),
    ).rejects.toThrow('create failed');

    expect(abortS3Upload).toHaveBeenCalledWith({
      pathname: expect.stringMatching(/^files\//),
    });
  });
});
