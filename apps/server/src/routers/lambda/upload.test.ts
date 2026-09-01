import { MAX_UPLOAD_FILE_SIZE, UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadRouter } from '@/server/routers/lambda/upload';

const mockAbortMultipartUpload = vi.fn();
const mockCompleteMultipartUpload = vi.fn();
const mockCreateMultipartUpload = vi.fn();
const mockCreatePreSignedUploadPartUrl = vi.fn();
const mockCreatePreSignedUrl = vi.fn();

vi.mock('@/server/modules/S3', () => ({
  FileS3: vi.fn(() => ({
    abortMultipartUpload: mockAbortMultipartUpload,
    completeMultipartUpload: mockCompleteMultipartUpload,
    createMultipartUpload: mockCreateMultipartUpload,
    createPreSignedUploadPartUrl: mockCreatePreSignedUploadPartUrl,
    createPreSignedUrl: mockCreatePreSignedUrl,
  })),
}));

describe('uploadRouter', () => {
  const caller = uploadRouter.createCaller({ userId: 'user-1' } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateMultipartUpload.mockResolvedValue('upload-id');
    mockCreatePreSignedUrl.mockResolvedValue('https://example.com/upload');
  });

  it('rejects oversized single upload presign requests', async () => {
    await expect(
      caller.createS3PreSignedUrl({
        pathname: 'files/huge.bin',
        size: MAX_UPLOAD_FILE_SIZE + 1,
      }),
    ).rejects.toThrow(UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE);

    expect(mockCreatePreSignedUrl).not.toHaveBeenCalled();
  });

  it('rejects oversized multipart upload creation requests', async () => {
    await expect(
      caller.createS3MultipartUpload({
        contentType: 'application/octet-stream',
        pathname: 'files/huge.bin',
        size: MAX_UPLOAD_FILE_SIZE + 1,
      }),
    ).rejects.toThrow(UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE);

    expect(mockCreateMultipartUpload).not.toHaveBeenCalled();
  });

  it('passes valid upload sizes through to storage signing', async () => {
    await expect(
      caller.createS3PreSignedUrl({
        pathname: 'files/ok.bin',
        size: MAX_UPLOAD_FILE_SIZE,
      }),
    ).resolves.toBe('https://example.com/upload');

    await expect(
      caller.createS3MultipartUpload({
        pathname: 'files/ok-large.bin',
        size: MAX_UPLOAD_FILE_SIZE,
      }),
    ).resolves.toEqual({ uploadId: 'upload-id' });

    expect(mockCreatePreSignedUrl).toHaveBeenCalledWith('files/ok.bin');
    expect(mockCreateMultipartUpload).toHaveBeenCalledWith('files/ok-large.bin', undefined);
  });

  it('keeps upload size optional for released clients', async () => {
    await expect(
      caller.createS3PreSignedUrl({
        pathname: 'files/legacy.bin',
      }),
    ).resolves.toBe('https://example.com/upload');

    await expect(
      caller.createS3MultipartUpload({
        pathname: 'files/legacy-large.bin',
      }),
    ).resolves.toEqual({ uploadId: 'upload-id' });

    expect(mockCreatePreSignedUrl).toHaveBeenCalledWith('files/legacy.bin');
    expect(mockCreateMultipartUpload).toHaveBeenCalledWith('files/legacy-large.bin', undefined);
  });
});
