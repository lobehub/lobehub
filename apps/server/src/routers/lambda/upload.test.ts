import { MAX_UPLOAD_FILE_SIZE, UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadRouter } from '@/server/routers/lambda/upload';

const routerMocks = vi.hoisted(() => {
  const transactionClient = {};
  const model = {
    attachMultipartUpload: vi.fn(),
    create: vi.fn(),
    findActiveByPathname: vi.fn(),
    markCompleted: vi.fn(),
    touchActive: vi.fn(),
  };

  return {
    abortMultipartUpload: vi.fn(),
    businessFileUploadCheck: vi.fn(),
    completeMultipartUpload: vi.fn(),
    createMultipartUpload: vi.fn(),
    createPreSignedUploadPartUrl: vi.fn(),
    createPreSignedUrl: vi.fn(),
    fileUploadService: {
      assertActiveOrLegacy: vi.fn(),
      findLatest: vi.fn(),
      hasAnyLiveSession: vi.fn(),
      model,
      release: vi.fn(),
      releaseBestEffort: vi.fn(),
      touchActive: vi.fn(),
    },
    getFileMetadata: vi.fn(),
    model,
    serverDB: {
      transaction: vi.fn(async (callback: (trx: unknown) => unknown) =>
        callback(transactionClient),
      ),
    },
    transactionClient,
  };
});

const createUpload = (overrides: Record<string, unknown> = {}) => ({
  completedAt: null,
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  fileId: null,
  id: '00000000-0000-0000-0000-000000000001',
  multipartPartSize: null,
  multipartUploadId: null,
  pathname: 'files/test.bin',
  size: 100,
  status: 'active',
  updatedAt: new Date(),
  userId: 'user-1',
  workspaceId: null,
  ...overrides,
});

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => routerMocks.serverDB),
}));

vi.mock('@/business/server/lambda-routers/file', () => ({
  businessFileUploadCheck: routerMocks.businessFileUploadCheck,
}));

vi.mock('@/server/services/fileUpload', () => ({
  FILE_UPLOAD_SESSION_TTL: 2 * 60 * 60 * 1000,
  FileUploadService: vi.fn(() => routerMocks.fileUploadService),
}));

vi.mock('@/server/modules/S3', () => ({
  FileS3: vi.fn(() => ({
    abortMultipartUpload: routerMocks.abortMultipartUpload,
    completeMultipartUpload: routerMocks.completeMultipartUpload,
    createMultipartUpload: routerMocks.createMultipartUpload,
    createPreSignedUploadPartUrl: routerMocks.createPreSignedUploadPartUrl,
    createPreSignedUrl: routerMocks.createPreSignedUrl,
    getFileMetadata: routerMocks.getFileMetadata,
  })),
}));

describe('uploadRouter', () => {
  const caller = uploadRouter.createCaller({ userId: 'user-1' } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    routerMocks.businessFileUploadCheck.mockResolvedValue(undefined);
    routerMocks.createMultipartUpload.mockResolvedValue('multipart-1');
    routerMocks.createPreSignedUrl.mockResolvedValue('https://example.com/upload');
    routerMocks.getFileMetadata.mockRejectedValue(
      Object.assign(new Error('Not Found'), { name: 'NotFound' }),
    );
    routerMocks.model.findActiveByPathname.mockResolvedValue(undefined);
    routerMocks.model.create.mockImplementation(async (input: Record<string, unknown>) =>
      createUpload(input),
    );
    routerMocks.model.attachMultipartUpload.mockImplementation(
      async (_id: string, multipartUploadId: string) =>
        createUpload({ multipartPartSize: 32 * 1024 * 1024, multipartUploadId }),
    );
    routerMocks.fileUploadService.findLatest.mockResolvedValue(undefined);
    routerMocks.fileUploadService.hasAnyLiveSession.mockResolvedValue(false);
    routerMocks.fileUploadService.assertActiveOrLegacy.mockResolvedValue(undefined);
    routerMocks.fileUploadService.touchActive.mockResolvedValue(undefined);
  });

  it('refuses to reserve a pathname that already holds an object', async () => {
    routerMocks.getFileMetadata.mockResolvedValue({ contentLength: 100 });

    await expect(
      caller.createS3PreSignedUrl({ pathname: 'files/someone-elses.bin', size: 100 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(routerMocks.businessFileUploadCheck).not.toHaveBeenCalled();
    expect(routerMocks.model.create).not.toHaveBeenCalled();
  });

  it('rejects oversized requests before reserving or creating storage state', async () => {
    await expect(
      caller.createS3PreSignedUrl({
        pathname: 'files/huge.bin',
        size: MAX_UPLOAD_FILE_SIZE + 1,
      }),
    ).rejects.toThrow(UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE);

    expect(routerMocks.businessFileUploadCheck).not.toHaveBeenCalled();
    expect(routerMocks.createPreSignedUrl).not.toHaveBeenCalled();
  });

  it('reserves quota in the transaction before signing the exact PUT length', async () => {
    await expect(
      caller.createS3PreSignedUrl({ pathname: 'files/test.bin', size: 100 }),
    ).resolves.toBe('https://example.com/upload');

    expect(routerMocks.businessFileUploadCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        actualSize: 100,
        transaction: routerMocks.transactionClient,
        userId: 'user-1',
      }),
    );
    expect(routerMocks.model.create).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: 'files/test.bin', size: 100 }),
      routerMocks.transactionClient,
    );
    expect(routerMocks.createPreSignedUrl).toHaveBeenCalledWith('files/test.bin', 100);
  });

  it('does not issue upload credentials when reservation is rejected', async () => {
    routerMocks.businessFileUploadCheck.mockRejectedValue(new Error('quota exceeded'));

    await expect(
      caller.createS3PreSignedUrl({ pathname: 'files/test.bin', size: 100 }),
    ).rejects.toThrow('quota exceeded');

    expect(routerMocks.model.create).not.toHaveBeenCalled();
    expect(routerMocks.createPreSignedUrl).not.toHaveBeenCalled();
  });

  it('keeps missing-size requests on the legacy path', async () => {
    await expect(caller.createS3PreSignedUrl({ pathname: 'files/legacy.bin' })).resolves.toBe(
      'https://example.com/upload',
    );

    expect(routerMocks.businessFileUploadCheck).not.toHaveBeenCalled();
    expect(routerMocks.model.create).not.toHaveBeenCalled();
    expect(routerMocks.createPreSignedUrl).toHaveBeenCalledWith('files/legacy.bin');
  });

  it('stores the server-selected multipart size and signs the exact final part length', async () => {
    const partSize = 32 * 1024 * 1024;
    const size = partSize + 5;

    await expect(
      caller.createS3MultipartUpload({ pathname: 'files/test.bin', size }),
    ).resolves.toEqual({ partSize, uploadId: 'multipart-1' });

    const upload = createUpload({
      multipartPartSize: partSize,
      multipartUploadId: 'multipart-1',
      size,
    });
    routerMocks.fileUploadService.assertActiveOrLegacy.mockResolvedValue(upload);
    routerMocks.createPreSignedUploadPartUrl.mockResolvedValue('https://example.com/part');

    await caller.createS3MultipartUploadPartUrl({
      partNumber: 2,
      pathname: 'files/test.bin',
      uploadId: 'multipart-1',
    });

    expect(routerMocks.createPreSignedUploadPartUrl).toHaveBeenCalledWith(
      'files/test.bin',
      'multipart-1',
      2,
      5,
    );
  });

  it('derives multipart completion expectations from the owned session', async () => {
    const partSize = 32 * 1024 * 1024;
    const upload = createUpload({
      multipartPartSize: partSize,
      multipartUploadId: 'multipart-1',
      size: partSize + 5,
    });
    routerMocks.fileUploadService.assertActiveOrLegacy.mockResolvedValue(upload);

    await caller.completeS3MultipartUpload({
      partCount: 2,
      pathname: 'files/test.bin',
      uploadId: 'multipart-1',
    });

    expect(routerMocks.completeMultipartUpload).toHaveBeenCalledWith(
      'files/test.bin',
      'multipart-1',
      2,
      undefined,
      { partSize, size: partSize + 5 },
    );
    expect(routerMocks.model.markCompleted).toHaveBeenCalledWith(upload.id);
  });

  it('rejects multipart operations for a different upload id', async () => {
    routerMocks.fileUploadService.assertActiveOrLegacy.mockResolvedValue(
      createUpload({ multipartPartSize: 32 * 1024 * 1024, multipartUploadId: 'multipart-1' }),
    );

    await expect(
      caller.createS3MultipartUploadPartUrl({
        partNumber: 1,
        pathname: 'files/test.bin',
        uploadId: 'multipart-other',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(routerMocks.createPreSignedUploadPartUrl).not.toHaveBeenCalled();
  });

  it('does not fall back to legacy multipart access for another owned session', async () => {
    routerMocks.fileUploadService.assertActiveOrLegacy.mockRejectedValue(
      new TRPCError({ code: 'CONFLICT', message: 'Upload pathname belongs to another session' }),
    );

    await expect(
      caller.createS3MultipartUploadPartUrl({
        partNumber: 1,
        pathname: 'files/other-user.bin',
        uploadId: 'multipart-other',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(routerMocks.createPreSignedUploadPartUrl).not.toHaveBeenCalled();
  });
});
