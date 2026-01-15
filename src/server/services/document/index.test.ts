import { LobeChatDatabase } from '@lobechat/database';

import { loadFile } from '@lobechat/file-loaders';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';

import { FileService } from '../file';
import { DocumentService } from './index';

vi.mock('@/database/models/document');
vi.mock('@/database/models/file');
vi.mock('../file');
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

    mockFileModel = {} as any;

    mockFileService = {
      downloadFileToLocal: vi.fn(),
    } as any;

    vi.mocked(DocumentModel).mockImplementation(() => mockDocumentModel);
    vi.mocked(FileModel).mockImplementation(() => mockFileModel);
    vi.mocked(FileService).mockImplementation(() => mockFileService);

    documentService = new DocumentService(mockDB, userId);
  });

  describe('createDocument', () => {
    it('should create a document with all required fields', async () => {
      const params = {
        content: 'This is a test document.\nWith multiple lines.',
        editorData: { blocks: [] },
        fileType: 'text/markdown',
        knowledgeBaseId: 'kb-123',
        metadata: { author: 'Test User' },
        title: 'Test Document',
      };

      const expectedDocument = {
        content: params.content,
        editorData: params.editorData,
        fileId: null,
        fileType: params.fileType,
        filename: params.title,
        id: 'doc-1',
        metadata: params.metadata,
        pages: undefined,
        source: 'document',
        sourceType: 'api',
        title: params.title,
        totalCharCount: 45,
        totalLineCount: 2,
      } as any;

      vi.mocked(mockDocumentModel.create).mockResolvedValue(expectedDocument);

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
        totalCharCount: 45,
        totalLineCount: 2,
      });
      expect(result).toEqual(expectedDocument);
    });

    it('should create a document without knowledge base ID', async () => {
      const params = {
        content: 'Simple document',
        editorData: {},
        title: 'Simple Doc',
      };

      const expectedDocument = {
        content: params.content,
        editorData: params.editorData,
        fileId: undefined,
        fileType: 'custom/document',
        filename: params.title,
        id: 'doc-2',
        source: 'document',
        sourceType: 'api',
        title: params.title,
        totalCharCount: 15,
        totalLineCount: 1,
      } as any;

      vi.mocked(mockDocumentModel.create).mockResolvedValue(expectedDocument);

      const result = await documentService.createDocument(params);

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: undefined,
          fileType: 'custom/document',
          totalCharCount: 15,
          totalLineCount: 1,
        }),
      );
      expect(result).toEqual(expectedDocument);
    });

    it('should handle empty content correctly', async () => {
      const params = {
        editorData: {},
        title: 'Empty Document',
      };

      const expectedDocument = {
        editorData: params.editorData,
        fileId: undefined,
        fileType: 'custom/document',
        filename: params.title,
        id: 'doc-3',
        source: 'document',
        sourceType: 'api',
        title: params.title,
        totalCharCount: 0,
        totalLineCount: 0,
      } as any;

      vi.mocked(mockDocumentModel.create).mockResolvedValue(expectedDocument);

      const result = await documentService.createDocument(params);

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: undefined,
          totalCharCount: 0,
          totalLineCount: 0,
        }),
      );
      expect(result).toEqual(expectedDocument);
    });

    it('should calculate character and line counts correctly', async () => {
      const multiLineContent = 'Line 1\nLine 2\nLine 3\nLine 4';
      const params = {
        content: multiLineContent,
        editorData: {},
        title: 'Multi-line Doc',
      };

      const expectedDocument = {
        content: multiLineContent,
        editorData: params.editorData,
        fileType: 'custom/document',
        filename: params.title,
        id: 'doc-4',
        source: 'document',
        sourceType: 'api',
        title: params.title,
        totalCharCount: 27,
        totalLineCount: 4,
      } as any;

      vi.mocked(mockDocumentModel.create).mockResolvedValue(expectedDocument);

      const result = await documentService.createDocument(params);

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          totalCharCount: 27,
          totalLineCount: 4,
        }),
      );
      expect(result.totalCharCount).toBe(27);
      expect(result.totalLineCount).toBe(4);
    });

    it('should use default fileType when not provided', async () => {
      const params = {
        content: 'Test',
        editorData: {},
        title: 'Test',
      };

      vi.mocked(mockDocumentModel.create).mockResolvedValue({} as any);

      await documentService.createDocument(params);

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fileType: 'custom/document',
        }),
      );
    });
  });

  describe('queryDocuments', () => {
    it('should return all documents for the user', async () => {
      const mockDocuments = [
        {
          id: 'doc-1',
          title: 'Document 1',
        } as any,
        {
          id: 'doc-2',
          title: 'Document 2',
        } as any,
      ];

      vi.mocked(mockDocumentModel.query).mockResolvedValue(mockDocuments);

      const result = await documentService.queryDocuments();

      expect(mockDocumentModel.query).toHaveBeenCalledWith();
      expect(result).toEqual(mockDocuments);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no documents exist', async () => {
      vi.mocked(mockDocumentModel.query).mockResolvedValue([]);

      const result = await documentService.queryDocuments();

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });
  });

  describe('getDocumentById', () => {
    it('should return a document by ID', async () => {
      const documentId = 'doc-123';
      const mockDocument = {
        id: documentId,
        title: 'Test Document',
      } as any;

      vi.mocked(mockDocumentModel.findById).mockResolvedValue(mockDocument);

      const result = await documentService.getDocumentById(documentId);

      expect(mockDocumentModel.findById).toHaveBeenCalledWith(documentId);
      expect(result).toEqual(mockDocument);
    });

    it('should return null when document not found', async () => {
      const documentId = 'non-existent';

      vi.mocked(mockDocumentModel.findById).mockResolvedValue(null as any);

      const result = await documentService.getDocumentById(documentId);

      expect(mockDocumentModel.findById).toHaveBeenCalledWith(documentId);
      expect(result).toBeNull();
    });
  });

  describe('deleteDocument', () => {
    it('should delete a document by ID', async () => {
      const documentId = 'doc-123';

      vi.mocked(mockDocumentModel.delete).mockResolvedValue(undefined as any);

      await documentService.deleteDocument(documentId);

      expect(mockDocumentModel.delete).toHaveBeenCalledWith(documentId);
    });
  });

  describe('updateDocument', () => {
    it('should update document with new content and recalculate counts', async () => {
      const documentId = 'doc-123';
      const newContent = 'Updated content\nWith two lines';
      const params = {
        content: newContent,
      };

      const updatedDocument = {
        content: newContent,
        id: documentId,
        totalCharCount: 30,
        totalLineCount: 2,
      } as any;

      vi.mocked(mockDocumentModel.update).mockResolvedValue(updatedDocument);

      const result = await documentService.updateDocument(documentId, params);

      expect(mockDocumentModel.update).toHaveBeenCalledWith(documentId, {
        content: newContent,
        totalCharCount: 30,
        totalLineCount: 2,
      });
      expect(result).toEqual(updatedDocument);
    });

    it('should update document title and filename together', async () => {
      const documentId = 'doc-123';
      const params = {
        title: 'New Title',
      };

      vi.mocked(mockDocumentModel.update).mockResolvedValue({} as any);

      await documentService.updateDocument(documentId, params);

      expect(mockDocumentModel.update).toHaveBeenCalledWith(documentId, {
        filename: 'New Title',
        title: 'New Title',
      });
    });

    it('should update editorData', async () => {
      const documentId = 'doc-123';
      const newEditorData = { blocks: [{ type: 'paragraph', data: { text: 'Hello' } }] };
      const params = {
        editorData: newEditorData,
      };

      vi.mocked(mockDocumentModel.update).mockResolvedValue({} as any);

      await documentService.updateDocument(documentId, params);

      expect(mockDocumentModel.update).toHaveBeenCalledWith(documentId, {
        editorData: newEditorData,
      });
    });

    it('should update metadata', async () => {
      const documentId = 'doc-123';
      const newMetadata = { author: 'Updated Author', version: 2 };
      const params = {
        metadata: newMetadata,
      };

      vi.mocked(mockDocumentModel.update).mockResolvedValue({} as any);

      await documentService.updateDocument(documentId, params);

      expect(mockDocumentModel.update).toHaveBeenCalledWith(documentId, {
        metadata: newMetadata,
      });
    });

    it('should update multiple fields at once', async () => {
      const documentId = 'doc-123';
      const params = {
        content: 'New content',
        editorData: { blocks: [] },
        metadata: { updated: true },
        title: 'New Title',
      };

      vi.mocked(mockDocumentModel.update).mockResolvedValue({} as any);

      await documentService.updateDocument(documentId, params);

      expect(mockDocumentModel.update).toHaveBeenCalledWith(documentId, {
        content: 'New content',
        editorData: { blocks: [] },
        filename: 'New Title',
        metadata: { updated: true },
        title: 'New Title',
        totalCharCount: 11,
        totalLineCount: 1,
      });
    });

    it('should handle empty content update', async () => {
      const documentId = 'doc-123';
      const params = {
        content: '',
      };

      vi.mocked(mockDocumentModel.update).mockResolvedValue({} as any);

      await documentService.updateDocument(documentId, params);

      expect(mockDocumentModel.update).toHaveBeenCalledWith(documentId, {
        content: '',
        totalCharCount: 0,
        totalLineCount: 1,
      });
    });

    it('should not update fields when not provided', async () => {
      const documentId = 'doc-123';
      const params = {
        title: 'Only Title',
      };

      vi.mocked(mockDocumentModel.update).mockResolvedValue({} as any);

      await documentService.updateDocument(documentId, params);

      expect(mockDocumentModel.update).toHaveBeenCalledWith(documentId, {
        filename: 'Only Title',
        title: 'Only Title',
      });

      const callArgs = vi.mocked(mockDocumentModel.update).mock.calls[0][1];
      expect(callArgs).not.toHaveProperty('content');
      expect(callArgs).not.toHaveProperty('editorData');
      expect(callArgs).not.toHaveProperty('metadata');
    });
  });

  describe('parseFile', () => {
    it('should parse file and create document successfully', async () => {
      const fileId = 'file-123';
      const mockFilePath = '/tmp/test-file.pdf';
      const mockCleanup = vi.fn();

      const mockFileData = {
        cleanup: mockCleanup,
        file: {
          fileType: 'application/pdf',
          name: 'test-file.pdf',
          url: 'https://example.com/file.pdf',
        },
        filePath: mockFilePath,
      };

      const mockLoadedFile = {
        content: 'Parsed file content',
        fileType: 'application/pdf',
        metadata: {
          title: 'Test PDF Document',
        },
        pages: 5,
        totalCharCount: 19,
        totalLineCount: 1,
      };

      const expectedDocument = {
        content: mockLoadedFile.content,
        fileId: fileId,
        fileType: mockFileData.file.fileType,
        id: 'doc-new',
        metadata: mockLoadedFile.metadata,
        pages: mockLoadedFile.pages,
        source: mockFileData.file.url,
        sourceType: 'file',
        title: mockLoadedFile.metadata?.title,
        totalCharCount: mockLoadedFile.totalCharCount,
        totalLineCount: mockLoadedFile.totalLineCount,
      } as any;

      vi.mocked(mockFileService.downloadFileToLocal).mockResolvedValue(mockFileData as any);
      vi.mocked(loadFile).mockResolvedValue(mockLoadedFile as any);
      vi.mocked(mockDocumentModel.create).mockResolvedValue(expectedDocument);

      const result = await documentService.parseFile(fileId);

      expect(mockFileService.downloadFileToLocal).toHaveBeenCalledWith(fileId);
      expect(loadFile).toHaveBeenCalledWith(mockFilePath);
      expect(mockDocumentModel.create).toHaveBeenCalledWith({
        content: mockLoadedFile.content,
        fileId: fileId,
        fileType: mockFileData.file.fileType,
        metadata: mockLoadedFile.metadata,
        pages: mockLoadedFile.pages,
        source: mockFileData.file.url,
        sourceType: 'file',
        title: mockLoadedFile.metadata?.title,
        totalCharCount: mockLoadedFile.totalCharCount,
        totalLineCount: mockLoadedFile.totalLineCount,
      });
      expect(mockCleanup).toHaveBeenCalled();
      expect(result).toEqual(expectedDocument);
    });

    it('should call cleanup even when file parsing fails', async () => {
      const fileId = 'file-456';
      const mockCleanup = vi.fn();

      const mockFileData = {
        cleanup: mockCleanup,
        file: {
          fileType: 'application/pdf',
          name: 'corrupted.pdf',
          url: 'https://example.com/corrupted.pdf',
        },
        filePath: '/tmp/corrupted.pdf',
      };

      vi.mocked(mockFileService.downloadFileToLocal).mockResolvedValue(mockFileData as any);
      vi.mocked(loadFile).mockRejectedValue(new Error('File parsing failed'));

      await expect(documentService.parseFile(fileId)).rejects.toThrow('File parsing failed');

      expect(mockCleanup).toHaveBeenCalled();
    });

    it('should call cleanup even when document creation fails', async () => {
      const fileId = 'file-789';
      const mockCleanup = vi.fn();

      const mockFileData = {
        cleanup: mockCleanup,
        file: {
          fileType: 'text/plain',
          name: 'test.txt',
          url: 'https://example.com/test.txt',
        },
        filePath: '/tmp/test.txt',
      };

      const mockLoadedFile = {
        content: 'Test content',
        fileType: 'text/plain',
        metadata: {},
        totalCharCount: 12,
        totalLineCount: 1,
      };

      vi.mocked(mockFileService.downloadFileToLocal).mockResolvedValue(mockFileData as any);
      vi.mocked(loadFile).mockResolvedValue(mockLoadedFile as any);
      vi.mocked(mockDocumentModel.create).mockRejectedValue(new Error('Database error'));

      await expect(documentService.parseFile(fileId)).rejects.toThrow('Database error');

      expect(mockCleanup).toHaveBeenCalled();
    });

    it('should handle files without metadata title', async () => {
      const fileId = 'file-no-title';
      const mockCleanup = vi.fn();

      const mockFileData = {
        cleanup: mockCleanup,
        file: {
          fileType: 'text/plain',
          name: 'simple.txt',
          url: 'https://example.com/simple.txt',
        },
        filePath: '/tmp/simple.txt',
      };

      const mockLoadedFile = {
        content: 'Simple content',
        fileType: 'text/plain',
        metadata: {},
        totalCharCount: 14,
        totalLineCount: 1,
      };

      const expectedDocument = {
        content: mockLoadedFile.content,
        fileId: fileId,
        fileType: mockFileData.file.fileType,
        id: 'doc-simple',
        metadata: mockLoadedFile.metadata,
        source: mockFileData.file.url,
        sourceType: 'file',
        title: undefined,
        totalCharCount: mockLoadedFile.totalCharCount,
        totalLineCount: mockLoadedFile.totalLineCount,
      } as any;

      vi.mocked(mockFileService.downloadFileToLocal).mockResolvedValue(mockFileData as any);
      vi.mocked(loadFile).mockResolvedValue(mockLoadedFile as any);
      vi.mocked(mockDocumentModel.create).mockResolvedValue(expectedDocument);

      const result = await documentService.parseFile(fileId);

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: undefined,
        }),
      );
      expect(result.title).toBeUndefined();
      expect(mockCleanup).toHaveBeenCalled();
    });
  });
});
