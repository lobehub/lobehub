import { DocumentItem } from '@lobechat/database/schemas';
import { FileDocument, loadFile } from '@lobechat/file-loaders';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { LobeChatDatabase } from '@/database/type';
import { DocumentSourceType, LobeDocument } from '@/types/document';

import { FileService } from '../file';
import { DocumentService } from './index';

// Mock the dependencies
vi.mock('@lobechat/file-loaders', () => ({
  loadFile: vi.fn(),
}));

vi.mock('../file', () => ({
  FileService: vi.fn(),
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(),
}));

describe('DocumentService', () => {
  let service: DocumentService;
  let mockDb: LobeChatDatabase;
  let mockDocumentModel: any;
  let mockFileModel: any;
  let mockFileService: any;
  const userId = 'test-user-id';

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock database
    mockDb = {} as LobeChatDatabase;

    // Create mock models
    mockDocumentModel = {
      create: vi.fn(),
      query: vi.fn(),
      findById: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    };

    mockFileModel = {};

    mockFileService = {
      downloadFileToLocal: vi.fn(),
    };

    // Setup constructor mocks
    (DocumentModel as any).mockImplementation(() => mockDocumentModel);
    (FileModel as any).mockImplementation(() => mockFileModel);
    (FileService as any).mockImplementation(() => mockFileService);

    service = new DocumentService(mockDb, userId);
  });

  describe('createDocument', () => {
    it('should create a document with all parameters', async () => {
      const mockDocument: DocumentItem = {
        id: 'doc-1',
        userId,
        title: 'Test Document',
        content: 'Test content\nLine 2',
        fileType: 'custom/document',
        filename: 'Test Document',
        totalCharCount: 19,
        totalLineCount: 2,
        metadata: { author: 'Test' },
        editorData: { blocks: [] },
        source: 'document',
        sourceType: 'api',
        createdAt: new Date(),
        updatedAt: new Date(),
        accessedAt: new Date(),
        fileId: null,
        pages: [],
        clientId: null,
        parentId: null,
        slug: null,
      };

      mockDocumentModel.create.mockResolvedValue(mockDocument);

      const result = await service.createDocument({
        title: 'Test Document',
        content: 'Test content\nLine 2',
        editorData: { blocks: [] },
        metadata: { author: 'Test' },
        knowledgeBaseId: 'kb-1',
      });

      expect(mockDocumentModel.create).toHaveBeenCalledWith({
        content: 'Test content\nLine 2',
        editorData: { blocks: [] },
        fileId: null,
        fileType: 'custom/document',
        filename: 'Test Document',
        metadata: { author: 'Test' },
        pages: undefined,
        source: 'document',
        sourceType: 'api',
        title: 'Test Document',
        totalCharCount: 19,
        totalLineCount: 2,
      });

      expect(result).toEqual(mockDocument);
    });

    it('should create a document with minimal parameters', async () => {
      const mockDocument: DocumentItem = {
        id: 'doc-2',
        userId,
        title: 'Minimal Document',
        content: null,
        fileType: 'custom/document',
        filename: 'Minimal Document',
        totalCharCount: 0,
        totalLineCount: 0,
        metadata: null,
        editorData: {},
        source: 'document',
        sourceType: 'api',
        createdAt: new Date(),
        updatedAt: new Date(),
        accessedAt: new Date(),
        fileId: null,
        pages: [],
        clientId: null,
        parentId: null,
        slug: null,
      };

      mockDocumentModel.create.mockResolvedValue(mockDocument);

      const result = await service.createDocument({
        title: 'Minimal Document',
        editorData: {},
      });

      expect(mockDocumentModel.create).toHaveBeenCalledWith({
        content: undefined,
        editorData: {},
        fileId: undefined,
        fileType: 'custom/document',
        filename: 'Minimal Document',
        metadata: undefined,
        pages: undefined,
        source: 'document',
        sourceType: 'api',
        title: 'Minimal Document',
        totalCharCount: 0,
        totalLineCount: 0,
      });

      expect(result).toEqual(mockDocument);
    });

    it('should create a document with custom fileType', async () => {
      const mockDocument: DocumentItem = {
        id: 'doc-3',
        userId,
        title: 'Custom Type',
        content: 'content',
        fileType: 'custom/markdown',
        filename: 'Custom Type',
        totalCharCount: 7,
        totalLineCount: 1,
        metadata: null,
        editorData: {},
        source: 'document',
        sourceType: 'api',
        createdAt: new Date(),
        updatedAt: new Date(),
        accessedAt: new Date(),
        fileId: null,
        pages: [],
        clientId: null,
        parentId: null,
        slug: null,
      };

      mockDocumentModel.create.mockResolvedValue(mockDocument);

      const result = await service.createDocument({
        title: 'Custom Type',
        content: 'content',
        editorData: {},
        fileType: 'custom/markdown',
      });

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fileType: 'custom/markdown',
        }),
      );

      expect(result).toEqual(mockDocument);
    });

    it('should calculate character count correctly for empty content', async () => {
      mockDocumentModel.create.mockResolvedValue({} as DocumentItem);

      await service.createDocument({
        title: 'Empty Content',
        content: '',
        editorData: {},
      });

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          totalCharCount: 0,
          totalLineCount: 1,
        }),
      );
    });

    it('should calculate line count correctly for multiline content', async () => {
      mockDocumentModel.create.mockResolvedValue({} as DocumentItem);

      await service.createDocument({
        title: 'Multiline',
        content: 'Line 1\nLine 2\nLine 3',
        editorData: {},
      });

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          totalCharCount: 20,
          totalLineCount: 3,
        }),
      );
    });
  });

  describe('queryDocuments', () => {
    it('should delegate to documentModel.query', async () => {
      const mockDocuments = [
        { id: 'doc-1', title: 'Doc 1' },
        { id: 'doc-2', title: 'Doc 2' },
      ];

      mockDocumentModel.query.mockResolvedValue(mockDocuments);

      const result = await service.queryDocuments();

      expect(mockDocumentModel.query).toHaveBeenCalledWith();
      expect(result).toEqual(mockDocuments);
    });
  });

  describe('getDocumentById', () => {
    it('should delegate to documentModel.findById with correct id', async () => {
      const mockDocument = { id: 'doc-1', title: 'Test Document' };
      mockDocumentModel.findById.mockResolvedValue(mockDocument);

      const result = await service.getDocumentById('doc-1');

      expect(mockDocumentModel.findById).toHaveBeenCalledWith('doc-1');
      expect(result).toEqual(mockDocument);
    });
  });

  describe('deleteDocument', () => {
    it('should delegate to documentModel.delete with correct id', async () => {
      const mockDeleteResult = { success: true };
      mockDocumentModel.delete.mockResolvedValue(mockDeleteResult);

      const result = await service.deleteDocument('doc-1');

      expect(mockDocumentModel.delete).toHaveBeenCalledWith('doc-1');
      expect(result).toEqual(mockDeleteResult);
    });
  });

  describe('updateDocument', () => {
    it('should update document with content and recalculate counts', async () => {
      const mockUpdateResult = { id: 'doc-1', content: 'Updated\nContent' };
      mockDocumentModel.update.mockResolvedValue(mockUpdateResult);

      const result = await service.updateDocument('doc-1', {
        content: 'Updated\nContent',
      });

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        content: 'Updated\nContent',
        totalCharCount: 15,
        totalLineCount: 2,
      });

      expect(result).toEqual(mockUpdateResult);
    });

    it('should update document with title and set filename', async () => {
      mockDocumentModel.update.mockResolvedValue({});

      await service.updateDocument('doc-1', {
        title: 'New Title',
      });

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        title: 'New Title',
        filename: 'New Title',
      });
    });

    it('should update document with editorData', async () => {
      mockDocumentModel.update.mockResolvedValue({});

      const newEditorData = { blocks: [{ type: 'paragraph' }] };
      await service.updateDocument('doc-1', {
        editorData: newEditorData,
      });

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        editorData: newEditorData,
      });
    });

    it('should update document with metadata', async () => {
      mockDocumentModel.update.mockResolvedValue({});

      const newMetadata = { author: 'Updated Author' };
      await service.updateDocument('doc-1', {
        metadata: newMetadata,
      });

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        metadata: newMetadata,
      });
    });

    it('should update document with multiple fields', async () => {
      mockDocumentModel.update.mockResolvedValue({});

      await service.updateDocument('doc-1', {
        title: 'Updated Title',
        content: 'Updated content',
        editorData: { blocks: [] },
        metadata: { version: 2 },
      });

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        title: 'Updated Title',
        filename: 'Updated Title',
        content: 'Updated content',
        totalCharCount: 15,
        totalLineCount: 1,
        editorData: { blocks: [] },
        metadata: { version: 2 },
      });
    });

    it('should handle empty content update correctly', async () => {
      mockDocumentModel.update.mockResolvedValue({});

      await service.updateDocument('doc-1', {
        content: '',
      });

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        content: '',
        totalCharCount: 0,
        totalLineCount: 1,
      });
    });

    it('should not update fields that are not provided', async () => {
      mockDocumentModel.update.mockResolvedValue({});

      await service.updateDocument('doc-1', {});

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {});
    });
  });

  describe('parseFile', () => {
    it('should parse file and create document successfully', async () => {
      const mockFile = {
        id: 'file-1',
        name: 'test.pdf',
        fileType: 'application/pdf',
        url: 'https://example.com/test.pdf',
      };

      const mockFileDocument: FileDocument = {
        content: 'Parsed content from PDF',
        fileType: 'application/pdf',
        filename: 'test.pdf',
        source: '/tmp/test.pdf',
        metadata: { title: 'PDF Document', author: 'Test Author' },
        pages: [
          {
            pageContent: 'Page 1',
            charCount: 6,
            lineCount: 1,
            metadata: { pageNumber: 1 },
          },
        ],
        totalCharCount: 23,
        totalLineCount: 1,
        createdTime: new Date(),
        modifiedTime: new Date(),
      };

      const mockCreatedDocument = {
        id: 'doc-1',
        content: 'Parsed content from PDF',
        fileType: 'application/pdf',
        metadata: { title: 'PDF Document', author: 'Test Author' },
        pages: [
          {
            pageContent: 'Page 1',
            charCount: 6,
            lineCount: 1,
            metadata: { pageNumber: 1 },
          },
        ],
        source: 'https://example.com/test.pdf',
        sourceType: DocumentSourceType.FILE,
        title: 'PDF Document',
        totalCharCount: 23,
        totalLineCount: 1,
        fileId: 'file-1',
        filename: 'test.pdf',
        editorData: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as LobeDocument;

      const mockCleanup = vi.fn();

      mockFileService.downloadFileToLocal.mockResolvedValue({
        filePath: '/tmp/test.pdf',
        file: mockFile,
        cleanup: mockCleanup,
      });

      vi.mocked(loadFile).mockResolvedValue(mockFileDocument);
      mockDocumentModel.create.mockResolvedValue(mockCreatedDocument);

      const result = await service.parseFile('file-1');

      expect(mockFileService.downloadFileToLocal).toHaveBeenCalledWith('file-1');
      expect(loadFile).toHaveBeenCalledWith('/tmp/test.pdf');

      expect(mockDocumentModel.create).toHaveBeenCalledWith({
        content: 'Parsed content from PDF',
        fileId: 'file-1',
        fileType: 'application/pdf',
        metadata: { title: 'PDF Document', author: 'Test Author' },
        pages: [
          {
            pageContent: 'Page 1',
            charCount: 6,
            lineCount: 1,
            metadata: { pageNumber: 1 },
          },
        ],
        source: 'https://example.com/test.pdf',
        sourceType: 'file',
        title: 'PDF Document',
        totalCharCount: 23,
        totalLineCount: 1,
      });

      expect(mockCleanup).toHaveBeenCalled();
      expect(result).toEqual(mockCreatedDocument);
    });

    it('should call cleanup even if parsing fails', async () => {
      const mockCleanup = vi.fn();

      mockFileService.downloadFileToLocal.mockResolvedValue({
        filePath: '/tmp/test.pdf',
        file: { name: 'test.pdf', fileType: 'application/pdf', url: 'test.com' },
        cleanup: mockCleanup,
      });

      vi.mocked(loadFile).mockRejectedValue(new Error('Parse error'));

      await expect(service.parseFile('file-1')).rejects.toThrow('Parse error');

      expect(mockCleanup).toHaveBeenCalled();
    });

    it('should call cleanup even if document creation fails', async () => {
      const mockCleanup = vi.fn();

      mockFileService.downloadFileToLocal.mockResolvedValue({
        filePath: '/tmp/test.pdf',
        file: { name: 'test.pdf', fileType: 'application/pdf', url: 'test.com' },
        cleanup: mockCleanup,
      });

      vi.mocked(loadFile).mockResolvedValue({
        content: 'content',
        fileType: 'pdf',
        filename: 'test.pdf',
        source: '/tmp/test.pdf',
        metadata: {},
        totalCharCount: 7,
        totalLineCount: 1,
        createdTime: new Date(),
        modifiedTime: new Date(),
      });

      mockDocumentModel.create.mockRejectedValue(new Error('DB error'));

      await expect(service.parseFile('file-1')).rejects.toThrow('DB error');

      expect(mockCleanup).toHaveBeenCalled();
    });

    it('should handle files without metadata title', async () => {
      const mockFileDocument: FileDocument = {
        content: 'Content',
        fileType: 'text/plain',
        filename: 'test.txt',
        source: '/tmp/test.txt',
        metadata: {},
        totalCharCount: 7,
        totalLineCount: 1,
        createdTime: new Date(),
        modifiedTime: new Date(),
      };

      const mockCleanup = vi.fn();

      mockFileService.downloadFileToLocal.mockResolvedValue({
        filePath: '/tmp/test.txt',
        file: { name: 'test.txt', fileType: 'text/plain', url: 'test.com' },
        cleanup: mockCleanup,
      });

      vi.mocked(loadFile).mockResolvedValue(mockFileDocument);
      mockDocumentModel.create.mockResolvedValue({} as LobeDocument);

      await service.parseFile('file-1');

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: undefined,
        }),
      );

      expect(mockCleanup).toHaveBeenCalled();
    });
  });
});
