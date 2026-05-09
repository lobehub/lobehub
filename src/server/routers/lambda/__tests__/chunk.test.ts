// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { DocumentModel } from '@/database/models/document';
import { EmbeddingModel } from '@/database/models/embedding';
import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { SearchRepo } from '@/database/repositories/search';
import { ChunkService } from '@/server/services/chunk';
import { DocumentService } from '@/server/services/document';

import { chunkRouter } from '../chunk';

vi.mock('@/database/models/asyncTask', () => ({ AsyncTaskModel: vi.fn() }));
vi.mock('@/database/models/chunk', () => ({ ChunkModel: vi.fn() }));
vi.mock('@/database/models/document', () => ({ DocumentModel: vi.fn() }));
vi.mock('@/database/models/embedding', () => ({ EmbeddingModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('@/database/models/message', () => ({ MessageModel: vi.fn() }));
vi.mock('@/database/repositories/search', () => ({ SearchRepo: vi.fn() }));
vi.mock('@/server/services/chunk', () => ({ ChunkService: vi.fn() }));
vi.mock('@/server/services/document', () => ({ DocumentService: vi.fn() }));
vi.mock('@/database/server', () => ({ getServerDB: vi.fn() }));

describe('chunkRouter.getFileContents — ID branching', () => {
  const userId = 'user_test';
  let mockCtx: any;
  let documentModelMock: any;
  let fileModelMock: any;
  let documentServiceMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    documentModelMock = { findById: vi.fn(), findByFileId: vi.fn() };
    fileModelMock = { findById: vi.fn() };
    documentServiceMock = { parseFile: vi.fn() };

    vi.mocked(DocumentModel).mockImplementation(() => documentModelMock);
    vi.mocked(FileModel).mockImplementation(() => fileModelMock);
    vi.mocked(DocumentService).mockImplementation(() => documentServiceMock);
    vi.mocked(AsyncTaskModel).mockImplementation(() => ({}) as any);
    vi.mocked(ChunkModel).mockImplementation(() => ({}) as any);
    vi.mocked(EmbeddingModel).mockImplementation(() => ({}) as any);
    vi.mocked(MessageModel).mockImplementation(() => ({}) as any);
    vi.mocked(SearchRepo).mockImplementation(() => ({}) as any);
    vi.mocked(ChunkService).mockImplementation(() => ({}) as any);

    mockCtx = {
      userId,
      asyncTaskModel: {},
      chunkModel: {},
      chunkService: {},
      documentModel: documentModelMock,
      documentService: documentServiceMock,
      embeddingModel: {},
      fileModel: fileModelMock,
      messageModel: {},
      searchRepo: {},
    };
  });

  it('reads docs_* directly from documents table without touching files', async () => {
    documentModelMock.findById.mockResolvedValue({
      content: '# 推荐信\n\nMain body text here.',
      filename: '推荐信.md',
      id: 'docs_pPAXDRIqlgxrG0HV',
      metadata: { tag: 'letter' },
      title: '推荐信',
    });

    const caller = chunkRouter.createCaller(mockCtx);
    const result = await caller.getFileContents({ fileIds: ['docs_pPAXDRIqlgxrG0HV'] });

    expect(documentModelMock.findById).toHaveBeenCalledWith('docs_pPAXDRIqlgxrG0HV');
    expect(fileModelMock.findById).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      content: '# 推荐信\n\nMain body text here.',
      fileId: 'docs_pPAXDRIqlgxrG0HV',
      filename: '推荐信',
      metadata: { tag: 'letter' },
    });
    expect(result[0].error).toBeUndefined();
  });

  it('returns "Document not found" for missing docs_* id', async () => {
    documentModelMock.findById.mockResolvedValue(undefined);

    const caller = chunkRouter.createCaller(mockCtx);
    const result = await caller.getFileContents({ fileIds: ['docs_missing'] });

    expect(result[0]).toMatchObject({
      content: '',
      error: 'Document not found',
      fileId: 'docs_missing',
    });
    expect(fileModelMock.findById).not.toHaveBeenCalled();
  });

  it('falls through to file lookup for file_* id', async () => {
    fileModelMock.findById.mockResolvedValue({ id: 'file_xyz', name: 'doc.pdf' });
    documentModelMock.findByFileId.mockResolvedValue({
      content: 'parsed pdf content',
      metadata: null,
    });

    const caller = chunkRouter.createCaller(mockCtx);
    const result = await caller.getFileContents({ fileIds: ['file_xyz'] });

    expect(fileModelMock.findById).toHaveBeenCalledWith('file_xyz');
    expect(documentModelMock.findByFileId).toHaveBeenCalledWith('file_xyz');
    expect(documentModelMock.findById).not.toHaveBeenCalled();
    expect(result[0]).toMatchObject({
      content: 'parsed pdf content',
      fileId: 'file_xyz',
      filename: 'doc.pdf',
    });
  });

  it('returns "File not found" for missing file_* id', async () => {
    fileModelMock.findById.mockResolvedValue(undefined);

    const caller = chunkRouter.createCaller(mockCtx);
    const result = await caller.getFileContents({ fileIds: ['file_missing'] });

    expect(result[0]).toMatchObject({
      content: '',
      error: 'File not found',
      fileId: 'file_missing',
    });
  });

  it('handles mixed batch of docs_* and file_*', async () => {
    documentModelMock.findById.mockResolvedValue({
      content: 'doc content',
      filename: 'note.md',
      id: 'docs_a',
      title: 'Note',
    });
    fileModelMock.findById.mockResolvedValue({ id: 'file_b', name: 'paper.pdf' });
    documentModelMock.findByFileId.mockResolvedValue({
      content: 'pdf content',
      metadata: null,
    });

    const caller = chunkRouter.createCaller(mockCtx);
    const result = await caller.getFileContents({ fileIds: ['docs_a', 'file_b'] });

    expect(result).toHaveLength(2);
    const docsResult = result.find((r) => r.fileId === 'docs_a');
    const fileResult = result.find((r) => r.fileId === 'file_b');
    expect(docsResult?.content).toBe('doc content');
    expect(fileResult?.content).toBe('pdf content');
  });
});
