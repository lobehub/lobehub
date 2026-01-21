import { LobeChatDatabase } from '@lobechat/database';
import { DocumentItem } from '@lobechat/database/schemas';
import { loadFile } from '@lobechat/file-loaders';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { LobeDocument } from '@/types/document';

import { FileService } from '../../file';
import { DocumentService } from '../index';

vi.mock('@/database/models/document');
vi.mock('@/database/models/file');
vi.mock('../../file');
vi.mock('@lobechat/file-loaders');

describe('DocumentService', () => {
  let documentService: DocumentService;
  let mockDB: LobeChatDatabase;
  let mockDocumentModel: DocumentModel;
  let mockFileModel: FileModel;
  let mockFileService: FileService;
  const userId = 'test-user-id';

  beforeEach(() => {
    mockDB = {} as LobeChatDatabase;

    mockDocumentModel = {
      create: vi.fn(),
      delete: vi.fn(),
      findById: vi.fn(),
      query: vi.fn(),
      update: vi.fn(),
    } as any;

    mockFileModel = {
      create: vi.fn(),
      delete: vi.fn(),
      findById: vi.fn(),
    } as any;

    mockFileService = {
      downloadFileToLocal: vi.fn(),
    } as any;

    // Mock constructors
    vi.mocked(DocumentModel).mockImplementation(() => mockDocumentModel);
    vi.mocked(FileModel).mockImplementation(() => mockFileModel);
    vi.mocked(FileService).mockImplementation(() => mockFileService);

    documentService = new DocumentService(mockDB, userId);
  });

  describe('createDocument', () => {
    it('should create a document with all parameters', async () => {
      const params = {
        content: 'This is test content\nwith multiple lines',
        editorData: { blocks: [] },
        fileType: 'text/plain',
        knowledgeBaseId: 'kb-1',
        metadata: { author: 'Test Author' },
        title: 'Test Document',
      };

      const mockCreatedDocument: DocumentItem = {
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
        source: 'document',
        sourceType: 'api',
        title: params.title,
        totalCharCount: params.content.length,
        totalLineCount: 2,
        updatedAt: new Date(),
        userId,
      };

      vi.mocked(mockDocumentModel.create).mockResolvedValue(mockCreatedDocument);

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
        totalCharCount: params.content.length,
        totalLineCount: 2,
      });
      expect(result).toEqual(mockCreatedDocument);
    });

    it('should create a document with minimal parameters and default fileType', async () => {
      const params = {
        content: 'Simple content',
        editorData: { blocks: [] },
        title: 'Simple Doc',
      };

      const mockCreatedDocument: DocumentItem = {
        accessedAt: new Date(),
        clientId: null,
        content: params.content,
        createdAt: new Date(),
        editorData: params.editorData,
        fileId: null,
        fileType: 'custom/document',
        filename: params.title,
        id: 'doc-2',
        metadata: null,
        pages: null,
        source: 'document',
        sourceType: 'api',
        title: params.title,
        totalCharCount: params.content.length,
        totalLineCount: 1,
        updatedAt: new Date(),
        userId,
      };

      vi.mocked(mockDocumentModel.create).mockResolvedValue(mockCreatedDocument);

      const result = await documentService.createDocument(params);

      expect(mockDocumentModel.create).toHaveBeenCalledWith({
        content: params.content,
        editorData: params.editorData,
        fileId: undefined,
        fileType: 'custom/document',
        filename: params.title,
        metadata: undefined,
        pages: undefined,
        source: 'document',
        sourceType: 'api',
        title: params.title,
        totalCharCount: 14,
        totalLineCount: 1,
      });
      expect(result).toEqual(mockCreatedDocument);
    });

    it('should handle empty content correctly', async () => {
      const params = {
        editorData: { blocks: [] },
        title: 'Empty Doc',
      };

      const mockCreatedDocument: DocumentItem = {
        accessedAt: new Date(),
        clientId: null,
        content: null,
        createdAt: new Date(),
        editorData: params.editorData,
        fileId: null,
        fileType: 'custom/document',
        filename: params.title,
        id: 'doc-3',
        metadata: null,
        pages: null,
        source: 'document',
        sourceType: 'api',
        title: params.title,
        totalCharCount: 0,
        totalLineCount: 0,
        updatedAt: new Date(),
        userId,
      };

      vi.mocked(mockDocumentModel.create).mockResolvedValue(mockCreatedDocument);

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
      expect(result).toEqual(mockCreatedDocument);
    });
  });

  describe('queryDocuments', () => {
    it('should query all documents for the user', async () => {
      const mockDocuments: DocumentItem[] = [
        {
          accessedAt: new Date(),
          clientId: null,
          content: 'Doc 1',
          createdAt: new Date(),
          editorData: {},
          fileId: null,
          fileType: 'custom/document',
          filename: 'Doc 1',
          id: 'doc-1',
          metadata: null,
          pages: null,
          source: 'document',
          sourceType: 'api',
          title: 'Doc 1',
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
          filename: 'Doc 2',
          id: 'doc-2',
          metadata: null,
          pages: null,
          source: 'document',
          sourceType: 'api',
          title: 'Doc 2',
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

      expect(mockDocumentModel.query).toHaveBeenCalledWith();
      expect(result).toEqual([]);
    });
  });

  describe('getDocumentById', () => {
    it('should get a document by ID', async () => {
      const mockDocument: DocumentItem = {
        accessedAt: new Date(),
        clientId: null,
        content: 'Test content',
        createdAt: new Date(),
        editorData: {},
        fileId: null,
        fileType: 'custom/document',
        filename: 'Test Doc',
        id: 'doc-1',
        metadata: null,
        pages: null,
        source: 'document',
        sourceType: 'api',
        title: 'Test Doc',
        totalCharCount: 12,
        totalLineCount: 1,
        updatedAt: new Date(),
        userId,
      };

      vi.mocked(mockDocumentModel.findById).mockResolvedValue(mockDocument);

      const result = await documentService.getDocumentById('doc-1');

      expect(mockDocumentModel.findById).toHaveBeenCalledWith('doc-1');
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
    it('should delete a document by ID', async () => {
      vi.mocked(mockDocumentModel.delete).mockResolvedValue(undefined as any);

      await documentService.deleteDocument('doc-1');

      expect(mockDocumentModel.delete).toHaveBeenCalledWith('doc-1');
    });
  });

  describe('updateDocument', () => {
    it('should update document content and recalculate metrics', async () => {
      const updatedContent = 'Updated content\nwith two lines';
      const params = {
        content: updatedContent,
      };

      vi.mocked(mockDocumentModel.update).mockResolvedValue(undefined as any);

      await documentService.updateDocument('doc-1', params);

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        content: updatedContent,
        totalCharCount: updatedContent.length,
        totalLineCount: 2,
      });
    });

    it('should update editorData without affecting content metrics', async () => {
      const params = {
        editorData: { blocks: [{ type: 'paragraph', data: { text: 'New' } }] },
      };

      vi.mocked(mockDocumentModel.update).mockResolvedValue(undefined as any);

      await documentService.updateDocument('doc-1', params);

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        editorData: params.editorData,
      });
    });

    it('should update title and filename together', async () => {
      const params = {
        title: 'New Title',
      };

      vi.mocked(mockDocumentModel.update).mockResolvedValue(undefined as any);

      await documentService.updateDocument('doc-1', params);

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        filename: 'New Title',
        title: 'New Title',
      });
    });

    it('should update metadata', async () => {
      const params = {
        metadata: { author: 'New Author', tags: ['test'] },
      };

      vi.mocked(mockDocumentModel.update).mockResolvedValue(undefined as any);

      await documentService.updateDocument('doc-1', params);

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        metadata: params.metadata,
      });
    });

    it('should update multiple fields simultaneously', async () => {
      const params = {
        content: 'New content',
        metadata: { version: 2 },
        title: 'Updated Title',
      };

      vi.mocked(mockDocumentModel.update).mockResolvedValue(undefined as any);

      await documentService.updateDocument('doc-1', params);

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        content: 'New content',
        filename: 'Updated Title',
        metadata: { version: 2 },
        title: 'Updated Title',
        totalCharCount: 11,
        totalLineCount: 1,
      });
    });

    it('should handle empty string content correctly', async () => {
      const params = {
        content: '',
      };

      vi.mocked(mockDocumentModel.update).mockResolvedValue(undefined as any);

      await documentService.updateDocument('doc-1', params);

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        content: '',
        totalCharCount: 0,
        totalLineCount: 1,
      });
    });
  });

  describe('parseFile', () => {
    it('should parse file and create document successfully', async () => {
      const fileId = 'file-1';
      const mockFile = {
        fileType: 'application/pdf',
        id: fileId,
        name: 'test.pdf',
        url: '/files/test.pdf',
      };

      const mockFilePath = '/tmp/test.pdf';
      const mockCleanup = vi.fn();

      const mockFileDocument = {
        content: 'Parsed file content',
        fileType: 'application/pdf',
        metadata: { title: 'Test PDF', pages: 10 },
        pages: 10,
        totalCharCount: 19,
        totalLineCount: 1,
      };

      const mockCreatedDocument = {
        content: mockFileDocument.content,
        createdAt: new Date(),
        editorData: null,
        fileId,
        fileType: mockFile.fileType,
        filename: mockFileDocument.metadata.title || '',
        id: 'doc-1',
        metadata: mockFileDocument.metadata,
        pages: mockFileDocument.pages,
        source: mockFile.url,
        sourceType: 'file' as const,
        title: mockFileDocument.metadata.title,
        totalCharCount: mockFileDocument.totalCharCount,
        totalLineCount: mockFileDocument.totalLineCount,
        updatedAt: new Date(),
      };

      vi.mocked(mockFileService.downloadFileToLocal).mockResolvedValue({
        cleanup: mockCleanup,
        file: mockFile as any,
        filePath: mockFilePath,
      });

      vi.mocked(loadFile).mockResolvedValue(mockFileDocument as any);
      vi.mocked(mockDocumentModel.create).mockResolvedValue(mockCreatedDocument as any);

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
        title: mockFileDocument.metadata.title,
        totalCharCount: mockFileDocument.totalCharCount,
        totalLineCount: mockFileDocument.totalLineCount,
      });
      expect(mockCleanup).toHaveBeenCalled();
      expect(result).toEqual(mockCreatedDocument);
    });

    it('should cleanup file even when parsing fails', async () => {
      const fileId = 'file-1';
      const mockFile = {
        fileType: 'application/pdf',
        id: fileId,
        name: 'test.pdf',
        url: '/files/test.pdf',
      };

      const mockFilePath = '/tmp/test.pdf';
      const mockCleanup = vi.fn();

      vi.mocked(mockFileService.downloadFileToLocal).mockResolvedValue({
        cleanup: mockCleanup,
        file: mockFile as any,
        filePath: mockFilePath,
      });

      const parseError = new Error('Failed to parse file');
      vi.mocked(loadFile).mockRejectedValue(parseError);

      await expect(documentService.parseFile(fileId)).rejects.toThrow('Failed to parse file');

      expect(mockFileService.downloadFileToLocal).toHaveBeenCalledWith(fileId);
      expect(loadFile).toHaveBeenCalledWith(mockFilePath);
      expect(mockCleanup).toHaveBeenCalled();
      expect(mockDocumentModel.create).not.toHaveBeenCalled();
    });

    it('should cleanup file even when document creation fails', async () => {
      const fileId = 'file-1';
      const mockFile = {
        fileType: 'application/pdf',
        id: fileId,
        name: 'test.pdf',
        url: '/files/test.pdf',
      };

      const mockFilePath = '/tmp/test.pdf';
      const mockCleanup = vi.fn();

      const mockFileDocument = {
        content: 'Parsed file content',
        fileType: 'application/pdf',
        metadata: { title: 'Test PDF' },
        pages: undefined,
        totalCharCount: 19,
        totalLineCount: 1,
      };

      vi.mocked(mockFileService.downloadFileToLocal).mockResolvedValue({
        cleanup: mockCleanup,
        file: mockFile as any,
        filePath: mockFilePath,
      });

      vi.mocked(loadFile).mockResolvedValue(mockFileDocument as any);

      const createError = new Error('Database error');
      vi.mocked(mockDocumentModel.create).mockRejectedValue(createError);

      await expect(documentService.parseFile(fileId)).rejects.toThrow('Database error');

      expect(mockFileService.downloadFileToLocal).toHaveBeenCalledWith(fileId);
      expect(loadFile).toHaveBeenCalledWith(mockFilePath);
      expect(mockDocumentModel.create).toHaveBeenCalled();
      expect(mockCleanup).toHaveBeenCalled();
    });

    it('should parse file with minimal metadata', async () => {
      const fileId = 'file-2';
      const mockFile = {
        fileType: 'text/plain',
        id: fileId,
        name: 'simple.txt',
        url: '/files/simple.txt',
      };

      const mockFilePath = '/tmp/simple.txt';
      const mockCleanup = vi.fn();

      const mockFileDocument = {
        content: 'Simple text',
        fileType: 'text/plain',
        metadata: {},
        pages: undefined,
        totalCharCount: 11,
        totalLineCount: 1,
      };

      const mockCreatedDocument = {
        content: mockFileDocument.content,
        createdAt: new Date(),
        editorData: null,
        fileId,
        fileType: mockFile.fileType,
        filename: '',
        id: 'doc-2',
        metadata: mockFileDocument.metadata,
        pages: null,
        source: mockFile.url,
        sourceType: 'file' as const,
        title: null,
        totalCharCount: mockFileDocument.totalCharCount,
        totalLineCount: mockFileDocument.totalLineCount,
        updatedAt: new Date(),
      };

      vi.mocked(mockFileService.downloadFileToLocal).mockResolvedValue({
        cleanup: mockCleanup,
        file: mockFile as any,
        filePath: mockFilePath,
      });

      vi.mocked(loadFile).mockResolvedValue(mockFileDocument as any);
      vi.mocked(mockDocumentModel.create).mockResolvedValue(mockCreatedDocument as any);

      const result = await documentService.parseFile(fileId);

      expect(mockDocumentModel.create).toHaveBeenCalledWith({
        content: mockFileDocument.content,
        fileId,
        fileType: mockFile.fileType,
        metadata: mockFileDocument.metadata,
        pages: undefined,
        source: mockFile.url,
        sourceType: 'file',
        title: undefined,
        totalCharCount: mockFileDocument.totalCharCount,
        totalLineCount: mockFileDocument.totalLineCount,
      });
      expect(mockCleanup).toHaveBeenCalled();
      expect(result).toEqual(mockCreatedDocument);
    });
  });
});
