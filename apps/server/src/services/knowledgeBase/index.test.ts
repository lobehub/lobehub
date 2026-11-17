// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChunkModel } from '@/database/models/chunk';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import { knowledgeBaseFiles } from '@/database/schemas';
import { buildWorkspaceWhere } from '@/database/utils/workspace';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { createFtsSearchRepo } from '@/server/services/ftsSearch';

import { DocumentService } from '../document';
import { KnowledgeBaseSearchService } from './index';

vi.mock('@/database/models/chunk', () => ({ ChunkModel: vi.fn() }));
vi.mock('@/database/models/document', () => ({ DocumentModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('@/database/models/knowledgeBase', () => ({ KnowledgeBaseModel: vi.fn() }));
vi.mock('@/server/services/ftsSearch', () => ({ createFtsSearchRepo: vi.fn() }));
vi.mock('../document', () => ({ DocumentService: vi.fn() }));
vi.mock('@/server/globalConfig', () => ({ getServerDefaultFilesConfig: vi.fn() }));
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));
vi.mock('@/database/utils/workspace', () => ({
  buildWorkspaceWhere: vi.fn(function () {
    return 'WORKSPACE_SCOPE';
  }),
}));

describe('KnowledgeBaseSearchService', () => {
  const userId = 'user_test';
  let chunkModelMock: any;
  let documentModelMock: any;
  let fileModelMock: any;
  let knowledgeBaseModelMock: any;
  let searchRepoMock: any;
  let documentServiceMock: any;
  let serverDB: any;
  let service: KnowledgeBaseSearchService;

  beforeEach(() => {
    vi.clearAllMocks();

    chunkModelMock = { semanticSearchForChat: vi.fn() };
    documentModelMock = { findById: vi.fn(), findByFileId: vi.fn() };
    fileModelMock = { findById: vi.fn() };
    knowledgeBaseModelMock = { getSearchIndexStatus: vi.fn().mockResolvedValue(undefined) };
    searchRepoMock = { searchKnowledgeBaseDocuments: vi.fn() };
    documentServiceMock = { parseFile: vi.fn() };
    serverDB = {
      query: {
        knowledgeBaseFiles: { findMany: vi.fn().mockResolvedValue([]) },
      },
    };

    vi.mocked(ChunkModel).mockImplementation(function () {
      return chunkModelMock;
    });
    vi.mocked(DocumentModel).mockImplementation(function () {
      return documentModelMock;
    });
    vi.mocked(FileModel).mockImplementation(function () {
      return fileModelMock;
    });
    vi.mocked(KnowledgeBaseModel).mockImplementation(function () {
      return knowledgeBaseModelMock;
    });
    vi.mocked(createFtsSearchRepo).mockResolvedValue(searchRepoMock);
    vi.mocked(DocumentService).mockImplementation(function () {
      return documentServiceMock;
    });

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

    describe('file-backed agent documents (uploaded into the Documents panel)', () => {
      // `AgentDocumentsService.importFile` stores the bytes in `files` and writes an empty
      // `documents` row pointing at them; only the original file holds the text.
      const placeholder = {
        content: '',
        fileId: 'file_RievR3MzZrMG',
        fileType: 'text/markdown',
        filename: 'product-spec.md',
        id: 'docs_sq6UdPi9clb74C4e',
        metadata: null,
        sourceType: 'file',
        title: 'product-spec.md',
        totalCharCount: 0,
      };

      it('reads docs_* through the underlying file instead of the empty placeholder', async () => {
        documentModelMock.findById.mockResolvedValue(placeholder);
        fileModelMock.findById.mockResolvedValue({
          id: 'file_RievR3MzZrMG',
          name: 'product-spec.md',
        });
        documentModelMock.findByFileId.mockResolvedValue(undefined);
        documentServiceMock.parseFile.mockResolvedValue({
          content: '# Product Spec\n\nShip the uploader.',
          metadata: null,
        });

        const result = await service.getFileContents(['docs_sq6UdPi9clb74C4e']);

        expect(fileModelMock.findById).toHaveBeenCalledWith('file_RievR3MzZrMG');
        expect(documentServiceMock.parseFile).toHaveBeenCalledWith('file_RievR3MzZrMG');
        expect(result[0]).toMatchObject({
          content: '# Product Spec\n\nShip the uploader.',
          fileId: 'docs_sq6UdPi9clb74C4e',
          filename: 'product-spec.md',
          totalCharCount: 34,
        });
        expect(result[0].error).toBeUndefined();
      });

      it('reuses an existing parse cache for the placeholder file', async () => {
        documentModelMock.findById.mockResolvedValue(placeholder);
        fileModelMock.findById.mockResolvedValue({
          id: 'file_RievR3MzZrMG',
          name: 'product-spec.md',
        });
        documentModelMock.findByFileId.mockResolvedValue({
          content: 'cached parse',
          metadata: null,
        });

        const result = await service.getFileContents(['docs_sq6UdPi9clb74C4e']);

        expect(documentServiceMock.parseFile).not.toHaveBeenCalled();
        expect(result[0]).toMatchObject({ content: 'cached parse', totalCharCount: 12 });
      });

      it('keeps reading an edited docs_* row that happens to reference a file', async () => {
        documentModelMock.findById.mockResolvedValue({
          ...placeholder,
          content: 'hand-written notes',
          fileType: 'custom/document',
        });

        const result = await service.getFileContents(['docs_sq6UdPi9clb74C4e']);

        expect(fileModelMock.findById).not.toHaveBeenCalled();
        expect(result[0].content).toBe('hand-written notes');
      });
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

    it('forwards the caller agent visibility to the selected BM25 backend', async () => {
      chunkModelMock.semanticSearchForChat.mockResolvedValue([]);
      searchRepoMock.searchKnowledgeBaseDocuments.mockResolvedValue([]);
      const scopedService = new KnowledgeBaseSearchService(
        serverDB,
        userId,
        'workspace-1',
        'public',
      );

      await scopedService.semanticSearchForChat({ knowledgeIds: ['kb_1'], query: 'hello' });

      expect(createFtsSearchRepo).toHaveBeenCalledWith({
        callerAgentVisibility: 'public',
        db: serverDB,
        usage: 'knowledge_base',
        userId,
        workspaceId: 'workspace-1',
      });
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

    it('scopes the knowledgeBaseFiles lookup to the caller (no cross-user KB resolution)', async () => {
      serverDB.query.knowledgeBaseFiles.findMany.mockResolvedValue([{ fileId: 'file_1' }]);
      chunkModelMock.semanticSearchForChat.mockResolvedValue([]);
      searchRepoMock.searchKnowledgeBaseDocuments.mockResolvedValue([]);

      await service.semanticSearchForChat({
        knowledgeIds: ['kb_victim'],
        query: 'hi',
      });

      // ownership predicate must be built for the caller's userId + table
      expect(buildWorkspaceWhere).toHaveBeenCalledWith(
        { userId, workspaceId: undefined },
        knowledgeBaseFiles,
      );
      // and it must be combined into the actual findMany WHERE clause
      const { where } = serverDB.query.knowledgeBaseFiles.findMany.mock.calls[0][0];
      expect(where).toBeDefined();
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

    describe('keyword fallback', () => {
      const hit = (documentId: string, relevance: number) => ({
        documentId,
        knowledgeBaseId: 'kb_1',
        relevance,
        snippet: documentId,
        title: documentId,
        updatedAt: new Date(0),
      });

      beforeEach(() => {
        chunkModelMock.semanticSearchForChat.mockResolvedValue([]);
      });

      it('ranks pages by how many keywords they hold when no page holds them all', async () => {
        searchRepoMock.searchKnowledgeBaseDocuments.mockImplementation(async (query: string) => {
          if (query === '环境变量') return [hit('docs_env', 2), hit('docs_basic', 5)];
          if (query === 'OPENAI_API_KEY') return [hit('docs_env', 1)];
          return [];
        });

        const result = await service.semanticSearchForChat({
          knowledgeIds: ['kb_1'],
          query: '环境变量 OPENAI_API_KEY 配置',
        });

        expect(
          searchRepoMock.searchKnowledgeBaseDocuments.mock.calls.map((c: any[]) => c[0]),
        ).toEqual(['环境变量 OPENAI_API_KEY 配置', '环境变量', 'OPENAI_API_KEY', '配置']);
        expect(result.documents.map((d) => [d.documentId, d.relevance])).toEqual([
          ['docs_env', 3],
          ['docs_basic', 5],
        ]);
        expect(result.indexStatus).toBeUndefined();
      });

      it('keeps strict hits and never fans out a single-keyword query', async () => {
        searchRepoMock.searchKnowledgeBaseDocuments.mockResolvedValueOnce([hit('docs_env', 1)]);

        await service.semanticSearchForChat({ knowledgeIds: ['kb_1'], query: 'env vars' });
        searchRepoMock.searchKnowledgeBaseDocuments.mockResolvedValue([]);
        await service.semanticSearchForChat({ knowledgeIds: ['kb_1'], query: 'env' });

        expect(searchRepoMock.searchKnowledgeBaseDocuments).toHaveBeenCalledTimes(2);
      });

      it('keeps at most three keyword searches in flight', async () => {
        let inFlight = 0;
        let peak = 0;
        searchRepoMock.searchKnowledgeBaseDocuments.mockImplementation(async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight -= 1;
          return [];
        });

        await service.semanticSearchForChat({ knowledgeIds: ['kb_1'], query: 'a b c d e f' });

        // One strict query, then one per keyword.
        expect(searchRepoMock.searchKnowledgeBaseDocuments).toHaveBeenCalledTimes(7);
        expect(peak).toBe(3);
      });

      it('still reports a full-text failure when every keyword search fails', async () => {
        searchRepoMock.searchKnowledgeBaseDocuments
          .mockResolvedValueOnce([])
          .mockRejectedValue(new Error('bm25 down'));

        const result = await service.semanticSearchForChat({
          knowledgeIds: ['kb_1'],
          query: 'env vars',
        });

        expect(result.errors?.bm25).toBe('bm25 down');
      });
    });

    describe('index status', () => {
      const status = {
        embeddedFiles: 0,
        keywordOnlyItems: 0,
        unindexedFileSamples: [{ id: 'file_env', name: 'environment-variables.mdx' }],
        unindexedFiles: 20,
      };

      beforeEach(() => {
        chunkModelMock.semanticSearchForChat.mockResolvedValue([]);
        searchRepoMock.searchKnowledgeBaseDocuments.mockResolvedValue([]);
      });

      it('reports what the libraries let search read when nothing matched', async () => {
        knowledgeBaseModelMock.getSearchIndexStatus.mockResolvedValue(status);
        const scopedService = new KnowledgeBaseSearchService(serverDB, userId, 'ws_1', 'public');

        const result = await scopedService.semanticSearchForChat({
          knowledgeIds: ['kb_1'],
          query: 'env',
        });

        expect(result.indexStatus).toEqual(status);
        expect(knowledgeBaseModelMock.getSearchIndexStatus).toHaveBeenCalledWith(
          ['kb_1'],
          'public',
        );
      });

      it('skips the lookup when something matched or no library was searched', async () => {
        chunkModelMock.semanticSearchForChat.mockResolvedValueOnce([
          { id: 'c1', fileId: 'f1', fileName: 'a.pdf', similarity: 0.9, text: 'aaa' },
        ]);
        await service.semanticSearchForChat({ knowledgeIds: ['kb_1'], query: 'env' });
        await service.semanticSearchForChat({ query: 'env' });

        expect(knowledgeBaseModelMock.getSearchIndexStatus).not.toHaveBeenCalled();
      });

      it('keeps an empty search successful when the lookup fails', async () => {
        knowledgeBaseModelMock.getSearchIndexStatus.mockRejectedValue(new Error('db down'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const result = await service.semanticSearchForChat({ knowledgeIds: ['kb_1'], query: 'x' });

        expect(result.totalResults).toBe(0);
        expect(result.indexStatus).toBeUndefined();
      });
    });
  });
});
