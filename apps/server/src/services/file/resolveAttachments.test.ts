// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { agentShareFileAccessScope } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  findUnresolvedAttachmentIds,
  resolveAttachmentMetadata,
  resolveAttachmentsByFileIds,
} from './resolveAttachments';

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
    // The model input layer reads the type to keep formats such as SVG out of vision parts.
    expect(result.imageList).toEqual([
      {
        alt: 'cat.png',
        id: 'file-visitor',
        mimeType: 'image/png',
        url: 'https://storage.example.com/agent-share/cat.png',
      },
    ]);
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

  it('reports the original size of text that was cut at parse time', async () => {
    mocks.findByIds.mockResolvedValue([
      { fileType: 'text/csv', id: 'file-big', name: 'big.csv', size: 42, url: 'files/big.csv' },
    ]);
    mocks.getFullFileUrl.mockResolvedValue('https://storage.example.com/files/big.csv');
    mocks.parseFile.mockResolvedValue({
      content: 'head',
      metadata: { originalCharCount: 9_000_000, truncated: true },
    });

    const result = await resolveAttachmentsByFileIds({
      db: {} as LobeChatDatabase,
      fileIds: ['file-big'],
      userId: 'user-1',
    });

    expect(result.fileList).toEqual([
      expect.objectContaining({ content: 'head', id: 'file-big', originalCharCount: 9_000_000 }),
    ]);
  });
});

describe('missing attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports every id as missing when none of them resolve', async () => {
    // A client that sends only placeholder ids (its upload failed) used to get
    // back an empty result with no warning, so nothing recorded the loss.
    mocks.findByIds.mockResolvedValue([]);

    const result = await resolveAttachmentsByFileIds({
      db: {} as LobeChatDatabase,
      fileIds: ['report.docx', 'scan.png'],
      userId: 'user-1',
    });

    expect(result.orderedFileIds).toEqual([]);
    expect(result.warnings).toEqual([
      'Attachment "report.docx" was not found and skipped.',
      'Attachment "scan.png" was not found and skipped.',
    ]);
  });

  it('lists the ids that match no readable file, once each, in caller order', async () => {
    mocks.findByIds.mockResolvedValue([{ id: 'file-ok' }]);

    await expect(
      findUnresolvedAttachmentIds({
        db: {} as LobeChatDatabase,
        fileIds: ['pending-1', 'file-ok', 'pending-1', 'pending-2'],
        userId: 'user-1',
      }),
    ).resolves.toEqual(['pending-1', 'pending-2']);
    expect(mocks.findByIds).toHaveBeenCalledWith(['pending-1', 'file-ok', 'pending-2'], {
      type: 'ordinary',
    });
  });

  it('skips the lookup when there are no ids', async () => {
    await expect(
      findUnresolvedAttachmentIds({ db: {} as LobeChatDatabase, fileIds: [], userId: 'user-1' }),
    ).resolves.toEqual([]);
    expect(mocks.findByIds).not.toHaveBeenCalled();
  });
});
