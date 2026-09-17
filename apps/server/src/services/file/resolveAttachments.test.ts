// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { agentShareFileAccessScope } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveAttachmentMetadata, resolveAttachmentsByFileIds } from './resolveAttachments';

const mocks = vi.hoisted(() => ({
  findByIds: vi.fn(),
  getFullFileUrl: vi.fn(),
  parseFile: vi.fn(),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn().mockImplementation(function () {
    return {
      findByIds: mocks.findByIds,
    };
  }),
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn().mockImplementation(function () {
    return { parseFile: mocks.parseFile };
  }),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return { getFullFileUrl: mocks.getFullFileUrl };
  }),
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

  it('uses the provenance-scoped reader for an agent-share run', async () => {
    const fileAccessScope = agentShareFileAccessScope({
      shareId: 'share-1',
      visitorUserId: 'visitor-1',
    });
    mocks.findByIds.mockResolvedValue([
      {
        fileType: 'image/png',
        id: 'file-visitor',
        name: 'cat.png',
        size: 42,
        url: 'agent-share/cat.png',
      },
    ]);
    mocks.getFullFileUrl.mockResolvedValue('https://storage.example.com/agent-share/cat.png');

    const result = await resolveAttachmentsByFileIds({
      db: {} as LobeChatDatabase,
      fileAccessScope,
      fileIds: ['file-visitor'],
      userId: 'creator-1',
    });

    expect(mocks.findByIds).toHaveBeenCalledWith(['file-visitor'], fileAccessScope);
    expect(result.orderedFileIds).toEqual(['file-visitor']);
  });

  it('passes share provenance into document parsing', async () => {
    const fileAccessScope = agentShareFileAccessScope({
      shareId: 'share-1',
      visitorUserId: 'visitor-1',
    });
    mocks.findByIds.mockResolvedValue([
      {
        fileType: 'application/pdf',
        id: 'file-visitor-pdf',
        name: 'report.pdf',
        size: 42,
        url: 'agent-share/report.pdf',
      },
    ]);
    mocks.getFullFileUrl.mockResolvedValue('https://storage.example.com/agent-share/report.pdf');
    mocks.parseFile.mockResolvedValue({ content: 'Visitor report' });

    const result = await resolveAttachmentsByFileIds({
      db: {} as LobeChatDatabase,
      fileAccessScope,
      fileIds: ['file-visitor-pdf'],
      userId: 'creator-1',
    });

    expect(mocks.parseFile).toHaveBeenCalledWith('file-visitor-pdf', fileAccessScope);
    expect(result.fileList).toEqual([
      expect.objectContaining({ content: 'Visitor report', id: 'file-visitor-pdf' }),
    ]);
  });
});
