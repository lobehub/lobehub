// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ingestAttachment } from './ingestAttachment';

const businessFileUploadCheck = vi.hoisted(() => vi.fn());

vi.mock('@/business/server/lambda-routers/file', () => ({
  businessFileTransferStorageCheck: vi.fn(),
  businessFileUploadCheck,
}));

const createFileService = () =>
  ({
    getFileAccessUrl: vi.fn().mockResolvedValue('https://cdn.test/a.pdf'),
    uploadFromBuffer: vi.fn().mockResolvedValue({ fileId: 'file-1', key: 'files/key' }),
  }) as any;

const source = () => ({
  buffer: Buffer.alloc(2048),
  mimeType: 'application/pdf',
  name: 'report.pdf',
  size: 4096,
});

describe('ingestAttachment storage quota', () => {
  beforeEach(() => {
    businessFileUploadCheck.mockReset().mockResolvedValue(undefined);
  });

  it('charges the stored buffer length against the caller workspace', async () => {
    const fileService = createFileService();

    await ingestAttachment(source(), fileService, 'user-1', 'ws-1');

    expect(businessFileUploadCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        actualSize: 2048,
        inputSize: 4096,
        userId: 'user-1',
        workspaceId: 'ws-1',
      }),
    );
    expect(fileService.uploadFromBuffer).toHaveBeenCalled();
  });

  it('never writes to storage when the quota check rejects', async () => {
    const fileService = createFileService();
    businessFileUploadCheck.mockRejectedValue(
      Object.assign(new Error('File storage is beyond the plan limit'), { code: 'FORBIDDEN' }),
    );

    await expect(ingestAttachment(source(), fileService, 'user-1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(fileService.uploadFromBuffer).not.toHaveBeenCalled();
  });
});
