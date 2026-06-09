// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChunkModel } from '@/database/models/chunk';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { SearchRepo } from '@/database/repositories/search';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { DocumentService } from '../document';
import { KnowledgeBaseSearchService } from './index';

vi.mock('@/database/models/chunk', () => ({ ChunkModel: vi.fn() }));
vi.mock('@/database/models/document', () => ({ DocumentModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('@/database/repositories/search', () => ({ SearchRepo: vi.fn() }));
vi.mock('../document', () => ({ DocumentService: vi.fn() }));
vi.mock('@/server/globalConfig', () => ({ getServerDefaultFilesConfig: vi.fn() }));
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));

describe('KnowledgeBaseSearchService', () => {
  const userId = 'user_test';
  let chunkModelMock: any;
  let documentModelMock: any;
  let fileModelMock: any;
  let searchRepoMock: any;
  let documentServiceMock: any;
  let serverDB: any;
  let service: KnowledgeBaseSearchService;

  beforeEach(() => {
    vi.clearAllMocks();

    chunkModelMock = { semanticSearchForChat: vi.fn() };
    documentModelMock = { findById: vi.fn(), findByFileId: vi.fn() };
    fileModelMock = { findById: vi.fn() };
    searchRepoMock = { searchKnowledgeBaseDocuments: vi.fn() };
    documentServiceMock = { parseFile: vi.fn() };
    serverDB = {
      query: {
        knowledgeBaseFiles: { findMany: vi.fn().mockResolvedValue([]) },
      },
    };

    vi.mocked(ChunkModel).mockImplementation(() => chunkModelMock);
    vi.mocked(DocumentModel).mockImplementation(() => documentModelMock);
    vi.mocked(FileModel).mockImplementation(() => fileModelMock);
    vi.mocked(SearchRepo).mockImplementation(() => searchRepoMock);
    vi.mocked(DocumentService).mockImplementation(() => documentServiceMock);

    service = new KnowledgeBaseSearchService(serverDB, userId);
  });

  describe('getFileContents', () => {
    it('reads docs_* directly from documents table without touching files', async () => {
      documentModelMock.findById.mockResolvedValue({
        content: '# Title\n\nBody.',
        filename: 'note.md',
        id: 'docs_abc',
        metadata: { tag: 'note' },
        title: 'Title',
      });

      const result = await service.getFileContents(['docs_abc']);

      expect(documentModelMock.findById).toHaveBeenCalledWith('docs_abc');
      expect(fileModelMock.findById).not.toHaveBeenCalled();
      expect(result[0]).toMatchObject({
        content: '# Title\n\nBody.',
        fileId: 'docs_abc',
        filename: 'Title',
        metadata: { tag: 'note' },
      });
      expect(result[0].error).toBeUndefined();
    });

    it('returns "Document not found" when docs_* id is missing', async () => {
      documentModelMock.findById.mockResolvedValue(undefined);

      const result = await service.getFileContents(['docs_missing']);

      expect(result[0]).toMatchObject({
        content: '',
        error: 'Document not found',
        fileId: 'docs_missing',
      });
      expect(fileModelMock.findById).not.toHaveBeenCalled();
    });

    it('returns parsed content for file_* via documentModel.findByFileId', async () => {
      fileModelMock.findById.mockResolvedValue({ id: 'file_xyz', name: 'doc.pdf' });
      documentModelMock.findByFileId.mockResolvedValue({
        content: 'parsed body',
        metadata: { pages: 2 },
      });

      const result = await service.getFileContents(['file_xyz']);

      expect(documentModelMock.findByFileId).toHaveBeenCalledWith('file_xyz');
      expect(documentServiceMock.parseFile).not.toHaveBeenCalled();
      expect(result[0]).toMatchObject({
        content: 'parsed body',
        fileId: 'file_xyz',
        filename: 'doc.pdf',
        metadata: { pages: 2 },
      });
    });

    it('falls back to documentService.parseFile when no parsed document exists', async () => {
      fileModelMock.findById.mockResolvedValue({ id: 'file_new', name: 'fresh.pdf' });
      documentModelMock.findByFileId.mockResolvedValue(undefined);
      documentServiceMock.parseFile.mockResolvedValue({
        content: 'just parsed',
        metadata: null,
      });

      const result = await service.getFileContents(['file_new']);

      expect(documentServiceMock.parseFile).toHaveBeenCalledWith('file_new');
      expect(result[0]).toMatchObject({
        content: 'just parsed',
        fileId: 'file_new',
        filename: 'fresh.pdf',
      });
      expect(result[0].error).toBeUndefined();
    });

    it('surfaces a parse failure as an error entry without throwing', async () => {
      fileModelMock.findById.mockResolvedValue({ id: 'file_bad', name: 'bad.pdf' });
      documentModelMock.findByFileId.mockResolvedValue(undefined);
      documentServiceMock.parseFile.mockRejectedValue(new Error('parser exploded'));

      const result = await service.getFileContents(['file_bad']);

      expect(result[0]).toMatchObject({
        content: '',
        error: 'Failed to parse file: parser exploded',
        fileId: 'file_bad',
        filename: 'bad.pdf',
      });
    });

    it('returns "File not found" when file_* id is missing', async () => {
      fileModelMock.findById.mockResolvedValue(undefined);

      const result = await service.getFileContents(['file_missing']);

      expect(result[0]).toMatchObject({
        content: '',
        error: 'File not found',
        fileId: 'file_missing',
      });
    });

    it('handles mixed batch of docs_* and file_* in one call', async () => {
      documentModelMock.findById.mockResolvedValue({
        content: 'note content',
        filename: 'note.md',
        id: 'docs_a',
        title: 'Note',
      });
      fileModelMock.findById.mockResolvedValue({ id: 'file_b', name: 'paper.pdf' });
      documentModelMock.findByFileId.mockResolvedValue({
        content: 'paper content',
        metadata: null,
      });

      const result = await service.getFileContents(['docs_a', 'file_b']);

      expect(result).toHaveLength(2);
      expect(result.find((r) => r.fileId === 'docs_a')?.content).toBe('note content');
      expect(result.find((r) => r.fileId === 'file_b')?.content).toBe('paper content');
    });
  });

  describe('semanticSearchForChat', () => {
    beforeEach(() => {
      vi.mocked(getServerDefaultFilesConfig).mockReturnValue({
        embeddingModel: { model: 'text-embedding-3-small', provider: 'openai' },
      } as any);
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({
        embeddings: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
      } as any);
    });

    it('groups chunks by file and ranks them by average top-3 similarity', async () => {
      chunkModelMock.semanticSearchForChat.mockResolvedValue([
        { id: 'c1', fileId: 'f1', fileName: 'a.pdf', similarity: 0.9, text: 'aaa' },
        { id: 'c2', fileId: 'f1', fileName: 'a.pdf', similarity: 0.8, text: 'bbb' },
        { id: 'c3', fileId: 'f2', fileName: 'b.pdf', similarity: 0.95, text: 'ccc' },
      ]);
      searchRepoMock.searchKnowledgeBaseDocuments.mockResolvedValue([]);

      const result = await service.semanticSearchForChat({
        knowledgeIds: ['kb_1'],
        query: 'hello',
        topK: 5,
      });

      expect(result.fileResults).toHaveLength(2);
      // f2 has higher single-chunk similarity → ranked first
      expect(result.fileResults[0].fileId).toBe('f2');
      expect(result.fileResults[1].fileId).toBe('f1');
      // f1's topChunks are sorted desc by similarity
      expect(result.fileResults[1].topChunks.map((c) => c.id)).toEqual(['c1', 'c2']);
      expect(result.chunks).toHaveLength(3);
      expect(result.totalResults).toBe(3);
      expect(result.errors).toBeUndefined();
      expect(result.rejections).toBeUndefined();
    });

    it('skips BM25 entirely when no knowledgeIds are provided', async () => {
      chunkModelMock.semanticSearchForChat.mockResolvedValue([]);

      const result = await service.semanticSearchForChat({ query: 'hi' });

      expect(searchRepoMock.searchKnowledgeBaseDocuments).not.toHaveBeenCalled();
      expect(result.documents).toEqual([]);
    });

    it('expands knowledgeIds into file_ids via knowledgeBaseFiles before vector search', async () => {
      serverDB.query.knowledgeBaseFiles.findMany.mockResolvedValue([
        { fileId: 'file_1' },
        { fileId: 'file_2' },
      ]);
      chunkModelMock.semanticSearchForChat.mockResolvedValue([]);
      searchRepoMock.searchKnowledgeBaseDocuments.mockResolvedValue([]);

      await service.semanticSearchForChat({
        fileIds: ['file_extra'],
        knowledgeIds: ['kb_x'],
        query: 'hi',
      });

      expect(chunkModelMock.semanticSearchForChat).toHaveBeenCalledWith(
        expect.objectContaining({
          fileIds: ['file_1', 'file_2', 'file_extra'],
        }),
      );
    });

    it('captures vector path failure in errors + rejections, keeps BM25 documents', async () => {
      chunkModelMock.semanticSearchForChat.mockRejectedValue(
        Object.assign(new Error('bad api key'), { errorType: 'InvalidProviderAPIKey' }),
      );
      searchRepoMock.searchKnowledgeBaseDocuments.mockResolvedValue([
        {
          documentId: 'docs_1',
          knowledgeBaseId: 'kb_1',
          relevance: 1.5,
          snippet: 'snip',
          title: 't',
          updatedAt: new Date(),
        },
      ]);

      const result = await service.semanticSearchForChat({
        knowledgeIds: ['kb_1'],
        query: 'hi',
      });

      expect(result.chunks).toEqual([]);
      expect(result.documents).toHaveLength(1);
      expect(result.errors?.vector).toBe('bad api key');
      expect(result.rejections?.vector).toMatchObject({ errorType: 'InvalidProviderAPIKey' });
      expect(result.errors?.bm25).toBeUndefined();
    });

    it('captures BM25 failure independently from a successful vector path', async () => {
      chunkModelMock.semanticSearchForChat.mockResolvedValue([
        { id: 'c1', fileId: 'f1', fileName: 'a.pdf', similarity: 0.9, text: 'aaa' },
      ]);
      searchRepoMock.searchKnowledgeBaseDocuments.mockRejectedValue(new Error('bm25 down'));

      const result = await service.semanticSearchForChat({
        knowledgeIds: ['kb_1'],
        query: 'hi',
      });

      expect(result.chunks).toHaveLength(1);
      expect(result.documents).toEqual([]);
      expect(result.errors?.bm25).toBe('bm25 down');
      expect(result.errors?.vector).toBeUndefined();
      expect(result.rejections?.bm25).toBeInstanceOf(Error);
    });

    it('returns empty results with both errors when both paths fail', async () => {
      chunkModelMock.semanticSearchForChat.mockRejectedValue(new Error('vec dead'));
      searchRepoMock.searchKnowledgeBaseDocuments.mockRejectedValue(new Error('bm25 dead'));

      const result = await service.semanticSearchForChat({
        knowledgeIds: ['kb_1'],
        query: 'hi',
      });

      expect(result.chunks).toEqual([]);
      expect(result.documents).toEqual([]);
      expect(result.fileResults).toEqual([]);
      expect(result.totalResults).toBe(0);
      expect(result.errors).toEqual({ bm25: 'bm25 dead', vector: 'vec dead' });
      expect(result.rejections?.vector).toBeDefined();
      expect(result.rejections?.bm25).toBeDefined();
    });
  });
});
