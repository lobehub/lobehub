// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveAttachmentMetadata } from './resolveAttachments';

const mocks = vi.hoisted(() => ({
  findByIds: vi.fn(),
  getFullFileUrl: vi.fn(),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn().mockImplementation(() => ({ findByIds: mocks.findByIds })),
}));

vi.mock('@/server/services/document', () => ({ DocumentService: vi.fn() }));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({ getFullFileUrl: mocks.getFullFileUrl })),
  getFileProxyUrl: (fileId: string) => `https://app.lobehub.com/f/${fileId}`,
}));

describe('resolveAttachmentMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a stable proxy URL alongside refreshed preview URLs', async () => {
    mocks.findByIds.mockResolvedValue([
      {
        fileType: 'application/pdf',
        id: 'file_historical',
        name: 'report.pdf',
        size: 42,
        url: 'tasks/report.pdf',
      },
    ]);
    mocks.getFullFileUrl.mockResolvedValue(
      'https://storage.example.com/tasks/report.pdf?X-Amz-Signature=current',
    );

    const result = await resolveAttachmentMetadata({
      db: {} as LobeChatDatabase,
      fileIds: ['file_historical'],
      userId: 'user-1',
    });

    expect(result).toEqual([
      {
        downloadUrl: 'https://app.lobehub.com/f/file_historical',
        fileType: 'application/pdf',
        id: 'file_historical',
        name: 'report.pdf',
        size: 42,
        url: 'https://storage.example.com/tasks/report.pdf?X-Amz-Signature=current',
      },
    ]);
  });
});
