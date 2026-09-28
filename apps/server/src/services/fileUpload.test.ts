import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileUploadModel } from '@/database/models/fileUpload';

import { FileUploadService, sweepFileUploads } from './fileUpload';

const upload = {
  completedAt: null,
  createdAt: new Date(),
  expiresAt: new Date(),
  fileId: null,
  id: '00000000-0000-0000-0000-000000000001',
  multipartPartSize: 32,
  multipartUploadId: 'multipart-1',
  pathname: 'files/expired.bin',
  size: 37,
  status: 'cleaning' as const,
  updatedAt: new Date(),
  userId: 'user-1',
  workspaceId: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sweepFileUploads', () => {
  it('releases quota only after idempotent storage cleanup succeeds', async () => {
    vi.spyOn(FileUploadModel, 'claimExpiredBatch').mockResolvedValue([upload]);
    const markExpired = vi.spyOn(FileUploadModel, 'markExpired').mockResolvedValue(upload as any);
    vi.spyOn(FileUploadModel, 'deleteTerminalBatch').mockResolvedValue(2);
    const storage = {
      abortMultipartUpload: vi.fn().mockRejectedValue({ name: 'NoSuchUpload' }),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    };

    await expect(sweepFileUploads({} as any, { storage })).resolves.toEqual({
      claimed: 1,
      deleted: 2,
      expired: 1,
      failed: 0,
    });

    expect(storage.deleteFile).toHaveBeenCalledWith(upload.pathname);
    expect(markExpired).toHaveBeenCalledWith({}, upload.id);
  });

  it('keeps a cleaning reservation when object deletion fails', async () => {
    vi.spyOn(FileUploadModel, 'claimExpiredBatch').mockResolvedValue([upload]);
    const markExpired = vi.spyOn(FileUploadModel, 'markExpired');
    vi.spyOn(FileUploadModel, 'deleteTerminalBatch').mockResolvedValue(0);
    const storage = {
      abortMultipartUpload: vi.fn().mockResolvedValue(undefined),
      deleteFile: vi.fn().mockRejectedValue(new Error('storage unavailable')),
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(sweepFileUploads({} as any, { storage })).resolves.toMatchObject({
      claimed: 1,
      expired: 0,
      failed: 1,
    });
    expect(markExpired).not.toHaveBeenCalled();
  });
});

describe('FileUploadService', () => {
  it("does not treat another owner's reserved pathname as a legacy upload", async () => {
    const service = new FileUploadService({} as any, 'user-1');
    vi.spyOn(service.model, 'touchActive').mockResolvedValue(undefined);
    vi.spyOn(service.model, 'findLatestByPathname').mockResolvedValue(undefined);
    vi.spyOn(FileUploadModel, 'hasLivePathname').mockResolvedValue(true);

    await expect(service.assertActiveOrLegacy('files/owned-by-user-2')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
