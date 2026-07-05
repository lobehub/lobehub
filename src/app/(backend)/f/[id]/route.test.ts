// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/auth';
import { FileModel } from '@/database/models/file';
import type { FileItem } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { FileService } from '@/server/services/file';

import { GET } from './route';

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

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

const fileModelMocks = vi.hoisted(() => {
  const instance = {
    findById: vi.fn(),
  };
  const constructor = vi.fn(() => instance);
  const getFileById = vi.fn();
  return {
    FileModel: Object.assign(constructor, { getFileById }),
    getFileById,
    instance,
  };
});

vi.mock('@/database/models/file', () => ({
  FileModel: fileModelMocks.FileModel,
}));

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/server/services/file', () => ({
  FileService: fileServiceMocks.FileService,
}));

describe('file proxy route', () => {
  const db = {} as LobeChatDatabase;

  beforeEach(async () => {
    vi.clearAllMocks();

    vi.mocked(getServerDB).mockResolvedValue(db);
    const { getServerDB: adaptorGetServerDB } = await import('@/database/core/db-adaptor');
    vi.mocked(adaptorGetServerDB).mockResolvedValue(db);

    vi.mocked(auth.api.getSession).mockResolvedValue({
      session: {} as any,
      user: { id: 'viewer-user-id' } as any,
    });

    fileServiceMocks.instance.createCachedPreSignedUrlForPreview.mockResolvedValue(
      'https://s3.example.com/presigned-preview-url',
    );
  });

  it('redirects to a cached presigned preview URL for a personal file the viewer owns', async () => {
    const file = {
      id: 'file-id',
      url: 'files/viewer-user-id/image.png',
      userId: 'viewer-user-id',
      workspaceId: null,
    } as FileItem;
    fileModelMocks.getFileById.mockResolvedValue(file);
    fileModelMocks.instance.findById.mockResolvedValue(file);

    const response = await GET(new Request('https://lobehub.com/f/file-id'), {
      params: Promise.resolve({ id: 'file-id' }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://s3.example.com/presigned-preview-url');
    expect(fileModelMocks.getFileById).toHaveBeenCalledWith(db, 'file-id');
    // Personal file → workspaceId argument is undefined so buildWorkspaceWhere
    // falls into the "userId = viewer AND workspaceId IS NULL" branch.
    expect(FileModel).toHaveBeenCalledWith(db, 'viewer-user-id', undefined);
    expect(fileModelMocks.instance.findById).toHaveBeenCalledWith('file-id');
    expect(FileService).toHaveBeenCalledWith(db, 'viewer-user-id');
    expect(fileServiceMocks.instance.createCachedPreSignedUrlForPreview).toHaveBeenCalledWith(
      'files/viewer-user-id/image.png',
    );
  });

  it('returns 404 when the file id does not exist at all', async () => {
    fileModelMocks.getFileById.mockResolvedValue(undefined);

    const response = await GET(new Request('https://lobehub.com/f/missing'), {
      params: Promise.resolve({ id: 'missing' }),
    });

    expect(response.status).toBe(404);
    expect(fileModelMocks.instance.findById).not.toHaveBeenCalled();
    expect(fileServiceMocks.instance.createCachedPreSignedUrlForPreview).not.toHaveBeenCalled();
  });

  it('returns 404 when the ownership-scoped lookup rejects the viewer (workspace private / cross-user / cross-workspace)', async () => {
    fileModelMocks.getFileById.mockResolvedValue({
      id: 'file-id',
      url: 'files/other-user/image.png',
      userId: 'other-user-id',
      workspaceId: 'ws-42',
    } as FileItem);
    fileModelMocks.instance.findById.mockResolvedValue(undefined);

    const response = await GET(new Request('https://lobehub.com/f/file-id'), {
      params: Promise.resolve({ id: 'file-id' }),
    });

    expect(response.status).toBe(404);
    // Second pass carried the file's workspaceId so buildWorkspaceWhere ran the
    // workspace-visibility check rather than the personal-mode fallback.
    expect(FileModel).toHaveBeenCalledWith(db, 'viewer-user-id', 'ws-42');
    expect(fileServiceMocks.instance.createCachedPreSignedUrlForPreview).not.toHaveBeenCalled();
  });

  it('redirects for a workspace-public file owned by another member (no X-Workspace-Id needed)', async () => {
    fileModelMocks.getFileById.mockResolvedValue({
      id: 'file-id',
      url: 'files/other-user/image.png',
      userId: 'other-user-id',
      workspaceId: 'ws-42',
    } as FileItem);
    fileModelMocks.instance.findById.mockResolvedValue({
      id: 'file-id',
      url: 'files/other-user/image.png',
      userId: 'other-user-id',
      workspaceId: 'ws-42',
    } as FileItem);

    const response = await GET(new Request('https://lobehub.com/f/file-id'), {
      params: Promise.resolve({ id: 'file-id' }),
    });

    expect(response.status).toBe(302);
    // workspaceId was derived from the file row, not the request headers.
    expect(FileModel).toHaveBeenCalledWith(db, 'viewer-user-id', 'ws-42');
    expect(FileService).toHaveBeenCalledWith(db, 'other-user-id');
  });
});
