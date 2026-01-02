import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import UploadFileServerCtr from '../UploadFileServerCtr';

vi.mock('@/services/fileSrv', () => ({
  default: class MockFileService {},
}));

const mockFileService = {
  getFileHTTPURL: vi.fn(),
  getFilePath: vi.fn(),
  deleteFiles: vi.fn(),
  uploadFile: vi.fn(),
};

const mockApp = {
  getService: vi.fn(() => mockFileService),
} as unknown as App;

describe('UploadFileServerCtr', () => {
  let controller: UploadFileServerCtr;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new UploadFileServerCtr(mockApp);
  });

  it('gets file path by id', async () => {
    mockFileService.getFilePath.mockResolvedValue('path');
    await expect(controller.getFileUrlById('id')).resolves.toBe('path');
    expect(mockFileService.getFilePath).toHaveBeenCalledWith('id');
  });

  it('gets HTTP URL', async () => {
    mockFileService.getFileHTTPURL.mockResolvedValue('url');
    await expect(controller.getFileHTTPURL('/path')).resolves.toBe('url');
    expect(mockFileService.getFileHTTPURL).toHaveBeenCalledWith('/path');
  });

  it('deletes files', async () => {
    mockFileService.deleteFiles.mockResolvedValue(undefined);
    await controller.deleteFiles(['a']);
    expect(mockFileService.deleteFiles).toHaveBeenCalledWith(['a']);
  });

  it('creates files via upload service', async () => {
    const params = { filename: 'file' } as any;
    mockFileService.uploadFile.mockResolvedValue({ success: true });

    await expect(controller.createFile(params)).resolves.toEqual({ success: true });
    expect(mockFileService.uploadFile).toHaveBeenCalledWith(params);
  });
});
