// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { documentRouter } from './document';

const mocks = vi.hoisted(() => ({ getDocumentById: vi.fn(), getFileAccessUrl: vi.fn() }));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('@/database/models/chunk', () => ({ ChunkModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('@/database/models/message', () => ({ MessageModel: vi.fn() }));
vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(),
  DOCUMENT_TRANSFER_FOREIGN_ROWS: 'foreign',
}));
vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn().mockImplementation(function () {
    return { getDocumentById: mocks.getDocumentById };
  }),
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return { getFileAccessUrl: mocks.getFileAccessUrl };
  }),
}));
vi.mock('./_helpers/knowledgeBaseAccess', () => ({
  assertContentsNotInRestrictedKnowledgeBase: vi.fn(),
  getRestrictedKnowledgeBaseIds: vi.fn(),
}));
const createCaller = createCallerFactory(documentRouter);
const caller = async () => createCaller(await createContextInner({ userId: 'user-1' }));

describe('document source URL resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFileAccessUrl.mockReset();
  });

  it('reads a text notebook without treating its origin label as an S3 object', async () => {
    const doc = {
      id: 'doc-1',
      source: 'notebook',
      sourceType: 'api',
      fileId: null,
      content: 'Report',
    };
    mocks.getDocumentById.mockResolvedValue(doc);
    mocks.getFileAccessUrl.mockRejectedValue(new Error('Storage is unavailable'));
    await expect((await caller()).getDocumentById({ id: 'doc-1' })).resolves.toEqual(doc);
    expect(mocks.getFileAccessUrl).not.toHaveBeenCalled();
  });

  it('still resolves a stored file source', async () => {
    mocks.getDocumentById.mockResolvedValue({
      id: 'doc-1',
      source: 'files/report.pdf',
      sourceType: 'file',
      fileId: 'file-1',
    });
    mocks.getFileAccessUrl.mockResolvedValue('https://storage.example/signed.pdf');
    await expect((await caller()).getDocumentById({ id: 'doc-1' })).resolves.toEqual(
      expect.objectContaining({ source: 'https://storage.example/signed.pdf' }),
    );
    expect(mocks.getFileAccessUrl).toHaveBeenCalledWith({
      id: 'doc-1',
      fileId: 'file-1',
      url: 'files/report.pdf',
    });
  });

  it('preserves an absolute web source', async () => {
    const doc = { id: 'doc-1', source: 'https://example.com/report', sourceType: 'web' };
    mocks.getDocumentById.mockResolvedValue(doc);
    await expect((await caller()).getDocumentById({ id: 'doc-1' })).resolves.toEqual(doc);
    expect(mocks.getFileAccessUrl).not.toHaveBeenCalled();
  });
});
