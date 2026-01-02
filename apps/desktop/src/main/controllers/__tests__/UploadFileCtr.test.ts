import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import { IpcHandler } from '@/utils/ipc/base';

import UploadFileCtr from '../UploadFileCtr';

const { ipcHandlers, ipcMainHandleMock } = vi.hoisted(() => {
  const handlers = new Map<string, (event: any, ...args: any[]) => any>();
  const handle = vi.fn((channel: string, handler: any) => {
    handlers.set(channel, handler);
  });
  return { ipcHandlers: handlers, ipcMainHandleMock: handle };
});

const invokeIpc = async <T = any>(channel: string, payload?: any): Promise<T> => {
  const handler = ipcHandlers.get(channel);
  if (!handler) throw new Error(`IPC handler for ${channel} not found`);

  const fakeEvent = { sender: { id: 'test' } as any };
  if (payload === undefined) return handler(fakeEvent);
  return handler(fakeEvent, payload);
};

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

// Mock FileService module to prevent electron dependency issues
vi.mock('@/services/fileSrv', () => ({
  default: class MockFileService {},
}));

// Mock FileService instance methods
const mockFileService = {
  uploadFile: vi.fn(),
};

const mockApp = {
  getService: vi.fn(() => mockFileService),
} as unknown as App;

describe('UploadFileCtr', () => {
  let controller: UploadFileCtr;

  beforeEach(() => {
    vi.clearAllMocks();
    ipcHandlers.clear();
    ipcMainHandleMock.mockClear();
    (IpcHandler.getInstance() as any).registeredChannels?.clear();
    controller = new UploadFileCtr(mockApp);
  });

  describe('uploadFile', () => {
    it('should upload file successfully', async () => {
      const params = {
        hash: 'abc123',
        path: '/test/file.txt',
        content: new ArrayBuffer(16),
        filename: 'file.txt',
        type: 'text/plain',
      };
      const expectedResult = { id: 'file-id-123', url: '/files/file-id-123' };
      mockFileService.uploadFile.mockResolvedValue(expectedResult);

      const result = await invokeIpc('upload.uploadFile', params);

      expect(result).toEqual(expectedResult);
      expect(mockFileService.uploadFile).toHaveBeenCalledWith(params);
    });

    it('should handle upload error', async () => {
      const params = {
        hash: 'abc123',
        path: '/test/file.txt',
        content: new ArrayBuffer(16),
        filename: 'file.txt',
        type: 'text/plain',
      };
      const error = new Error('Upload failed');
      mockFileService.uploadFile.mockRejectedValue(error);

      await expect(invokeIpc('upload.uploadFile', params)).rejects.toThrow('Upload failed');
    });
  });
});
