import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileService } from '@/server/services/file';

import { ServerBlobStore } from './ServerBlobStore';

const { getFileAccessUrl, uploadBase64 } = vi.hoisted(() => ({
  getFileAccessUrl: vi.fn().mockResolvedValue('https://files.example/access'),
  uploadBase64: vi.fn().mockResolvedValue({
    fileId: 'file-1',
    key: 'files/image.png',
    url: 'https://files.example/image.png',
  }),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({ getFileAccessUrl, uploadBase64 })),
}));

describe('ServerBlobStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defers FileService construction until the first blob operation', async () => {
    const store = new ServerBlobStore({} as LobeChatDatabase, 'user-1', 'workspace-1');

    expect(FileService).not.toHaveBeenCalled();

    await store.persistBase64('BASE64', 'files/image.png');
    await store.resolveUrl({ id: 'file-1' });

    expect(FileService).toHaveBeenCalledTimes(1);
    expect(uploadBase64).toHaveBeenCalledWith('BASE64', 'files/image.png');
    expect(getFileAccessUrl).toHaveBeenCalledWith({ id: 'file-1' });
  });

  it('surfaces missing storage configuration only when blob IO is requested', async () => {
    vi.mocked(FileService).mockImplementationOnce(() => {
      throw new Error('S3 environment variables are not set completely');
    });
    const createStore = () => new ServerBlobStore({} as LobeChatDatabase, 'user-1');

    expect(createStore).not.toThrow();
    const store = createStore();
    await expect(store.persistBase64('BASE64', 'files/image.png')).rejects.toThrow(
      'S3 environment variables are not set completely',
    );
  });
});
