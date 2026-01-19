import { LobeChatDatabase } from '@lobechat/database';
import { DocumentItem } from '@lobechat/database/schemas';
import { loadFile } from '@lobechat/file-loaders';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';

import { FileService } from '../../file';
import { DocumentService } from '../index';

vi.mock('@/database/models/document');
vi.mock('@/database/models/file');
vi.mock('../../file');
vi.mock('@lobechat/file-loaders');

describe('DocumentService', () => {
  let documentService: DocumentService;
  let mockDB: LobeChatDatabase;
  let mockDocumentModel: any;
  let mockFileModel: any;
  let mockFileService: any;
  const userId = 'test-user-id';

  beforeEach(() => {
    mockDB = {} as LobeChatDatabase;

    mockDocumentModel = {
      create: vi.fn(),
      delete: vi.fn(),
      findById: vi.fn(),
      query: vi.fn(),
      update: vi.fn(),
    };

    mockFileModel = {};

    mockFileService = {
      downloadFileToLocal: vi.fn(),
    };

    vi.mocked(DocumentModel).mockImplementation(() => mockDocumentModel);
    vi.mocked(FileModel).mockImplementation(() => mockFileModel);
    vi.mocked(FileService).mockImplementation(() => mockFileService);

    documentService = new DocumentService(mockDB, userId);
  });

  describe('createDocument', () => {
    it('should create document with all parameters', async () => {
      const params = {
        content: 'This is test content\nWith multiple lines',
        editorData: { blocks: [{ type: 'paragraph', data: { text: 'test' } }] },
        fileType: 'text/markdown',
        knowledgeBaseId: 'kb-123',
        metadata: { author: 'test user' },
        title: 'Test Document',
      };

      const mockCreatedDoc: DocumentItem = {
        accessedAt: new Date(),
        clientId: null,
        content: params.content,
        createdAt: new Date(),
        editorData: params.editorData,
        fileId: null,
        fileType: params.fileType,
        filename: params.title,
        id: 'doc-1',
        metadata: params.metadata,
        pages: null,
        parentId: null,
        slug: null,
        source: 'document',
        sourceType: 'api',
        title: params.title,
        totalCharCount: 40,
        totalLineCount: 2,
        updatedAt: new Date(),
        userId,
      };

      vi.mocked(mockDocumentModel.create).mockResolvedValue(mockCreatedDoc);

      const result = await documentService.createDocument(params);

      expect(mockDocumentModel.create).toHaveBeenCalledWith({
        content: params.content,
        editorData: params.editorData,
        fileId: null,
        fileType: params.fileType,
        filename: params.title,
        metadata: params.metadata,
        pages: undefined,
        source: 'document',
        sourceType: 'api',
        title: params.title,
        totalCharCount: 40,
        totalLineCount: 2,
      });
      expect(result).toEqual(mockCreatedDoc);
    });

    it('should create document with minimal parameters', async () => {
      const params = {
        editorData: { blocks: [] },
        title: 'Minimal Document',
      };

      const mockCreatedDoc: DocumentItem = {
        accessedAt: new Date(),
        clientId: null,
        content: null,
        createdAt: new Date(),
        editorData: params.editorData,
        fileId: null,
        fileType: 'custom/document',
        filename: params.title,
        id: 'doc-2',
        metadata: null,
        pages: null,
        parentId: null,
        slug: null,
        source: 'document',
        sourceType: 'api',
        title: params.title,
        totalCharCount: 0,
        totalLineCount: 0,
        updatedAt: new Date(),
        userId,
      };

      vi.mocked(mockDocumentModel.create).mockResolvedValue(mockCreatedDoc);

      const result = await documentService.createDocument(params);

      expect(mockDocumentModel.create).toHaveBeenCalledWith({
        content: undefined,
        editorData: params.editorData,
        fileId: undefined,
        fileType: 'custom/document',
        filename: params.title,
        metadata: undefined,
        pages: undefined,
        source: 'document',
        sourceType: 'api',
        title: params.title,
        totalCharCount: 0,
        totalLineCount: 0,
      });
      expect(result).toEqual(mockCreatedDoc);
    });

    it('should calculate character count correctly', async () => {
      const content = 'Hello World!';
      const params = {
        content,
        editorData: {},
        title: 'Test',
      };

      vi.mocked(mockDocumentModel.create).mockResolvedValue({} as DocumentItem);

      await documentService.createDocument(params);

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          totalCharCount: 12,
        }),
      );
    });

    it('should calculate line count correctly for multiline content', async () => {
      const content = 'Line 1\nLine 2\nLine 3';
      const params = {
        content,
        editorData: {},
        title: 'Test',
      };

      vi.mocked(mockDocumentModel.create).mockResolvedValue({} as DocumentItem);

      await documentService.createDocument(params);

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          totalLineCount: 3,
        }),
      );
    });

    it('should set fileId to null when knowledgeBaseId is provided', async () => {
      const params = {
        editorData: {},
        knowledgeBaseId: 'kb-456',
        title: 'KB Document',
      };

      vi.mocked(mockDocumentModel.create).mockResolvedValue({} as DocumentItem);

      await documentService.createDocument(params);

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: null,
        }),
      );
    });

    it('should set fileId to undefined when knowledgeBaseId is not provided', async () => {
      const params = {
        editorData: {},
        title: 'Regular Document',
      };

      vi.mocked(mockDocumentModel.create).mockResolvedValue({} as DocumentItem);

      await documentService.createDocument(params);

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: undefined,
        }),
      );
    });

    it('should use default fileType when not provided', async () => {
      const params = {
        editorData: {},
        title: 'Document Without Type',
      };

      vi.mocked(mockDocumentModel.create).mockResolvedValue({} as DocumentItem);

      await documentService.createDocument(params);

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fileType: 'custom/document',
        }),
      );
    });
  });

  describe('queryDocuments', () => {
    it('should return all documents from model', async () => {
      const mockDocuments: DocumentItem[] = [
        {
          accessedAt: new Date(),
          clientId: null,
          content: 'Doc 1',
          createdAt: new Date(),
          editorData: {},
          fileId: null,
          fileType: 'custom/document',
          filename: 'doc1.txt',
          id: 'doc-1',
          metadata: null,
          pages: null,
          parentId: null,
          slug: null,
          source: 'document',
          sourceType: 'api',
          title: 'Document 1',
          totalCharCount: 5,
          totalLineCount: 1,
          updatedAt: new Date(),
          userId,
        },
        {
          accessedAt: new Date(),
          clientId: null,
          content: 'Doc 2',
          createdAt: new Date(),
          editorData: {},
          fileId: null,
          fileType: 'custom/document',
          filename: 'doc2.txt',
          id: 'doc-2',
          metadata: null,
          pages: null,
          parentId: null,
          slug: null,
          source: 'document',
          sourceType: 'api',
          title: 'Document 2',
          totalCharCount: 5,
          totalLineCount: 1,
          updatedAt: new Date(),
          userId,
        },
      ];

      vi.mocked(mockDocumentModel.query).mockResolvedValue(mockDocuments);

      const result = await documentService.queryDocuments();

      expect(mockDocumentModel.query).toHaveBeenCalledWith();
      expect(result).toEqual(mockDocuments);
    });

    it('should return empty array when no documents exist', async () => {
      vi.mocked(mockDocumentModel.query).mockResolvedValue([]);

      const result = await documentService.queryDocuments();

      expect(result).toEqual([]);
    });
  });

  describe('getDocumentById', () => {
    it('should return document when found', async () => {
      const mockDocument: DocumentItem = {
        accessedAt: new Date(),
        clientId: null,
        content: 'Test content',
        createdAt: new Date(),
        editorData: {},
        fileId: null,
        fileType: 'custom/document',
        filename: 'test.txt',
        id: 'doc-123',
        metadata: null,
        pages: null,
        parentId: null,
        slug: null,
        source: 'document',
        sourceType: 'api',
        title: 'Test Document',
        totalCharCount: 12,
        totalLineCount: 1,
        updatedAt: new Date(),
        userId,
      };

      vi.mocked(mockDocumentModel.findById).mockResolvedValue(mockDocument);

      const result = await documentService.getDocumentById('doc-123');

      expect(mockDocumentModel.findById).toHaveBeenCalledWith('doc-123');
      expect(result).toEqual(mockDocument);
    });

    it('should return undefined when document not found', async () => {
      vi.mocked(mockDocumentModel.findById).mockResolvedValue(undefined);

      const result = await documentService.getDocumentById('non-existent');

      expect(mockDocumentModel.findById).toHaveBeenCalledWith('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('deleteDocument', () => {
    it('should delete document by id', async () => {
      vi.mocked(mockDocumentModel.delete).mockResolvedValue(undefined);

      await documentService.deleteDocument('doc-456');

      expect(mockDocumentModel.delete).toHaveBeenCalledWith('doc-456');
    });
  });

  describe('updateDocument', () => {
    it('should update content and recalculate counts', async () => {
      const content = 'Updated content\nWith two lines';
      const params = { content };

      vi.mocked(mockDocumentModel.update).mockResolvedValue(undefined);

      await documentService.updateDocument('doc-1', params);

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        content: 'Updated content\nWith two lines',
        totalCharCount: 30,
        totalLineCount: 2,
      });
    });

    it('should update title and filename together', async () => {
      const params = { title: 'New Title' };

      vi.mocked(mockDocumentModel.update).mockResolvedValue(undefined);

      await documentService.updateDocument('doc-1', params);

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        filename: 'New Title',
        title: 'New Title',
      });
    });

    it('should update editorData only', async () => {
      const params = { editorData: { blocks: [{ type: 'heading' }] } };

      vi.mocked(mockDocumentModel.update).mockResolvedValue(undefined);

      await documentService.updateDocument('doc-1', params);

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        editorData: { blocks: [{ type: 'heading' }] },
      });
    });

    it('should update metadata only', async () => {
      const params = { metadata: { tags: ['test', 'document'] } };

      vi.mocked(mockDocumentModel.update).mockResolvedValue(undefined);

      await documentService.updateDocument('doc-1', params);

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        metadata: { tags: ['test', 'document'] },
      });
    });

    it('should update multiple fields at once', async () => {
      const params = {
        content: 'New content',
        editorData: { blocks: [] },
        metadata: { version: 2 },
        title: 'Updated Title',
      };

      vi.mocked(mockDocumentModel.update).mockResolvedValue(undefined);

      await documentService.updateDocument('doc-1', params);

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        content: 'New content',
        editorData: { blocks: [] },
        filename: 'Updated Title',
        metadata: { version: 2 },
        title: 'Updated Title',
        totalCharCount: 11,
        totalLineCount: 1,
      });
    });

    it('should handle empty content update', async () => {
      const params = { content: '' };

      vi.mocked(mockDocumentModel.update).mockResolvedValue(undefined);

      await documentService.updateDocument('doc-1', params);

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        content: '',
        totalCharCount: 0,
        totalLineCount: 1,
      });
    });

    it('should not update fields that are not provided', async () => {
      const params = { title: 'Only Title' };

      vi.mocked(mockDocumentModel.update).mockResolvedValue(undefined);

      await documentService.updateDocument('doc-1', params);

      const callArgs = vi.mocked(mockDocumentModel.update).mock.calls[0][1];
      expect(callArgs).not.toHaveProperty('content');
      expect(callArgs).not.toHaveProperty('editorData');
      expect(callArgs).not.toHaveProperty('metadata');
    });
  });

  describe('parseFile', () => {
    it('should successfully parse file and create document', async () => {
      const fileId = 'file-123';
      const mockFile = {
        fileType: 'application/pdf',
        id: fileId,
        name: 'test.pdf',
        url: 'https://example.com/test.pdf',
      };

      const mockFilePath = '/tmp/test.pdf';
      const mockCleanup = vi.fn();

      const mockFileDocument = {
        content: 'Extracted text from PDF',
        fileType: 'application/pdf',
        metadata: { title: 'Test PDF', author: 'Test Author' },
        pages: [
          { charCount: 10, lineCount: 1, metadata: { pageNumber: 1 }, pageContent: 'Page 1' },
          { charCount: 13, lineCount: 1, metadata: { pageNumber: 2 }, pageContent: 'Page 2 text' },
        ],
        totalCharCount: 23,
        totalLineCount: 1,
      };

      const mockCreatedDoc: DocumentItem = {
        accessedAt: new Date(),
        clientId: null,
        content: mockFileDocument.content,
        createdAt: new Date(),
        editorData: null,
        fileId,
        fileType: mockFile.fileType,
        filename: null,
        id: 'doc-new',
        metadata: mockFileDocument.metadata,
        pages: mockFileDocument.pages,
        parentId: null,
        slug: null,
        source: mockFile.url,
        sourceType: 'file',
        title: mockFileDocument.metadata?.title || null,
        totalCharCount: mockFileDocument.totalCharCount,
        totalLineCount: mockFileDocument.totalLineCount,
        updatedAt: new Date(),
        userId,
      };

      vi.mocked(mockFileService.downloadFileToLocal).mockResolvedValue({
        cleanup: mockCleanup,
        file: mockFile,
        filePath: mockFilePath,
      });
      vi.mocked(loadFile).mockResolvedValue(mockFileDocument as any);
      vi.mocked(mockDocumentModel.create).mockResolvedValue(mockCreatedDoc);

      const result = await documentService.parseFile(fileId);

      expect(mockFileService.downloadFileToLocal).toHaveBeenCalledWith(fileId);
      expect(loadFile).toHaveBeenCalledWith(mockFilePath);
      expect(mockDocumentModel.create).toHaveBeenCalledWith({
        content: mockFileDocument.content,
        fileId,
        fileType: mockFile.fileType,
        metadata: mockFileDocument.metadata,
        pages: mockFileDocument.pages,
        source: mockFile.url,
        sourceType: 'file',
        title: mockFileDocument.metadata?.title,
        totalCharCount: mockFileDocument.totalCharCount,
        totalLineCount: mockFileDocument.totalLineCount,
      });
      expect(mockCleanup).toHaveBeenCalled();
      expect(result).toEqual(mockCreatedDoc);
    });

    it('should call cleanup even when file parsing fails', async () => {
      const fileId = 'file-456';
      const mockCleanup = vi.fn();
      const parseError = new Error('Failed to parse file');

      vi.mocked(mockFileService.downloadFileToLocal).mockResolvedValue({
        cleanup: mockCleanup,
        file: { fileType: 'application/pdf', id: fileId, name: 'fail.pdf', url: 'test-url' },
        filePath: '/tmp/fail.pdf',
      });
      vi.mocked(loadFile).mockRejectedValue(parseError);

      await expect(documentService.parseFile(fileId)).rejects.toThrow('Failed to parse file');

      expect(mockCleanup).toHaveBeenCalled();
    });

    it('should call cleanup even when document creation fails', async () => {
      const fileId = 'file-789';
      const mockCleanup = vi.fn();
      const createError = new Error('Failed to create document');

      vi.mocked(mockFileService.downloadFileToLocal).mockResolvedValue({
        cleanup: mockCleanup,
        file: { fileType: 'text/plain', id: fileId, name: 'test.txt', url: 'test-url' },
        filePath: '/tmp/test.txt',
      });
      vi.mocked(loadFile).mockResolvedValue({
        content: 'text',
        fileType: 'text/plain',
        metadata: {},
        totalCharCount: 4,
        totalLineCount: 1,
      } as any);
      vi.mocked(mockDocumentModel.create).mockRejectedValue(createError);

      await expect(documentService.parseFile(fileId)).rejects.toThrow('Failed to create document');

      expect(mockCleanup).toHaveBeenCalled();
    });

    it('should handle file without metadata', async () => {
      const fileId = 'file-no-meta';
      const mockCleanup = vi.fn();

      vi.mocked(mockFileService.downloadFileToLocal).mockResolvedValue({
        cleanup: mockCleanup,
        file: { fileType: 'text/plain', id: fileId, name: 'simple.txt', url: 'test-url' },
        filePath: '/tmp/simple.txt',
      });
      vi.mocked(loadFile).mockResolvedValue({
        content: 'Simple text',
        fileType: 'text/plain',
        metadata: undefined,
        totalCharCount: 11,
        totalLineCount: 1,
      } as any);
      vi.mocked(mockDocumentModel.create).mockResolvedValue({} as DocumentItem);

      await documentService.parseFile(fileId);

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: undefined,
          title: undefined,
        }),
      );
      expect(mockCleanup).toHaveBeenCalled();
    });

    it('should handle file with pages', async () => {
      const fileId = 'file-with-pages';
      const mockCleanup = vi.fn();
      const mockPages = [
        { charCount: 100, lineCount: 5, metadata: { pageNumber: 1 }, pageContent: 'Page 1' },
        { charCount: 150, lineCount: 7, metadata: { pageNumber: 2 }, pageContent: 'Page 2' },
      ];

      vi.mocked(mockFileService.downloadFileToLocal).mockResolvedValue({
        cleanup: mockCleanup,
        file: { fileType: 'application/pdf', id: fileId, name: 'multi.pdf', url: 'test-url' },
        filePath: '/tmp/multi.pdf',
      });
      vi.mocked(loadFile).mockResolvedValue({
        content: 'Multi-page content',
        fileType: 'application/pdf',
        metadata: { title: 'Multi-page Doc' },
        pages: mockPages,
        totalCharCount: 18,
        totalLineCount: 1,
      } as any);
      vi.mocked(mockDocumentModel.create).mockResolvedValue({} as DocumentItem);

      await documentService.parseFile(fileId);

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          pages: mockPages,
        }),
      );
      expect(mockCleanup).toHaveBeenCalled();
    });
  });
});
