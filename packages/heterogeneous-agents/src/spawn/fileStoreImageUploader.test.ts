import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFileStoreImageUploader, type FileStorePort } from './fileStoreImageUploader';

// sha256 of the bytes behind `PNG_BASE64`, i.e. what the port sees as `hash`.
const PNG_BASE64 = Buffer.from('fake-png-bytes').toString('base64');
const PNG_HASH = '3c6ed5fc41c950bf0db531eb22f945467fb8d999f80d82ba27dcc9fd90add54d';

const createPort = (overrides: Partial<FileStorePort> = {}): FileStorePort => ({
  checkFileHash: vi.fn().mockResolvedValue({ isExist: false }),
  createFile: vi.fn().mockResolvedValue({ id: 'file_1', url: 'https://cdn/x.png' }),
  createS3PreSignedUrl: vi.fn().mockResolvedValue('https://s3/presigned'),
  ...overrides,
});

describe('createFileStoreImageUploader', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads the bytes to S3 and returns the created file reference', async () => {
    const port = createPort();
    const upload = createFileStoreImageUploader(async () => port);

    const result = await upload({ data: PNG_BASE64, mediaType: 'image/png' });

    expect(result).toEqual({ fileId: 'file_1', url: 'https://cdn/x.png' });

    // The bytes are PUT to the pre-signed URL with the image's own media type.
    expect(fetch).toHaveBeenCalledWith('https://s3/presigned', {
      body: Buffer.from(PNG_BASE64, 'base64'),
      headers: { 'Content-Type': 'image/png' },
      method: 'PUT',
    });

    const createFileInput = vi.mocked(port.createFile).mock.calls[0][0];
    expect(createFileInput).toMatchObject({
      fileType: 'image/png',
      name: 'cc-read-image.png',
      size: Buffer.from(PNG_BASE64, 'base64').length,
    });
    // `url` is the S3 pathname, not the pre-signed URL.
    expect(createFileInput.url).toMatch(/^files\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{64}\.png$/);
  });

  it('reuses the stored object and skips the S3 PUT when the hash already exists', async () => {
    const port = createPort({
      checkFileHash: vi.fn().mockResolvedValue({ isExist: true, url: 'files/old/abc.png' }),
    });
    const upload = createFileStoreImageUploader(async () => port);

    await upload({ data: PNG_BASE64, mediaType: 'image/png' });

    expect(port.createS3PreSignedUrl).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.mocked(port.createFile).mock.calls[0][0].url).toBe('files/old/abc.png');
  });

  it('hashes the decoded bytes so identical images dedup across runs', async () => {
    const port = createPort();
    const upload = createFileStoreImageUploader(async () => port);

    await upload({ data: PNG_BASE64, mediaType: 'image/png' });

    expect(port.checkFileHash).toHaveBeenCalledWith({ hash: PNG_HASH });
    expect(vi.mocked(port.createFile).mock.calls[0][0].hash).toBe(PNG_HASH);
  });

  it('falls back to a png extension for an unknown media type', async () => {
    const port = createPort();
    const upload = createFileStoreImageUploader(async () => port);

    await upload({ data: PNG_BASE64, mediaType: 'image/avif' });

    expect(vi.mocked(port.createFile).mock.calls[0][0].name).toBe('cc-read-image.png');
  });

  it('returns undefined when no file store is available, so the placeholder survives', async () => {
    const upload = createFileStoreImageUploader(async () => undefined);

    await expect(upload({ data: PNG_BASE64, mediaType: 'image/png' })).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws when the S3 PUT fails, letting the pipeline degrade to the placeholder', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' }),
    );
    const port = createPort();
    const upload = createFileStoreImageUploader(async () => port);

    await expect(upload({ data: PNG_BASE64, mediaType: 'image/png' })).rejects.toThrow(
      'Upload failed: 403 Forbidden',
    );
    expect(port.createFile).not.toHaveBeenCalled();
  });
});
