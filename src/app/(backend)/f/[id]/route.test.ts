// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileModel } from '@/database/models/file';
import type { FileItem } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { FileService } from '@/server/services/file';

import { GET } from './route';

const fileServiceMocks = vi.hoisted(() => {
  const instance = {
    createCachedPreSignedUrlForPreview: vi.fn(),
    getFullFileUrl: vi.fn(),
  };

  return {
    FileService: vi.fn(() => instance),
    instance,
  };
});

vi.mock('@/database/models/file', () => ({
  FileModel: {
    getFileById: vi.fn(),
  },
}));

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/server/services/file', () => ({
  FileService: fileServiceMocks.FileService,
}));

describe('file proxy route', () => {
  const db = {} as LobeChatDatabase;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getServerDB).mockResolvedValue(db);
    vi.mocked(FileModel.getFileById).mockResolvedValue({
      id: 'file-id',
      url: 'files/user-id/image.png',
      userId: 'owner-user-id',
    } as FileItem);
    fileServiceMocks.instance.createCachedPreSignedUrlForPreview.mockResolvedValue(
      'https://s3.example.com/presigned-preview-url',
    );
  });

  it('should redirect to a cached presigned preview URL instead of a public full file URL', async () => {
    const response = await GET(new Request('https://lobehub.com/f/file-id'), {
      params: Promise.resolve({ id: 'file-id' }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://s3.example.com/presigned-preview-url');
    expect(FileModel.getFileById).toHaveBeenCalledWith(db, 'file-id');
    expect(FileService).toHaveBeenCalledWith(db, 'owner-user-id');
    expect(fileServiceMocks.instance.createCachedPreSignedUrlForPreview).toHaveBeenCalledWith(
      'files/user-id/image.png',
    );
    expect(fileServiceMocks.instance.getFullFileUrl).not.toHaveBeenCalled();
  });
});
