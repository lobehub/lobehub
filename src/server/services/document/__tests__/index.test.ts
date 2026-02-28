import { type LobeChatDatabase } from '@lobechat/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';

import { FileService } from '../../file';
import { DocumentService } from '../index';

vi.mock('@/database/models/document');
vi.mock('@/database/models/file');
vi.mock('../../file');
vi.mock('@lobechat/file-loaders', () => ({
  loadFile: vi.fn(),
}));
vi.mock('debug', () => ({
  default: () => vi.fn(),
}));

const { loadFile } = await import('@lobechat/file-loaders');

describe('DocumentService', () => {
  let service: DocumentService;
  let mockDb: LobeChatDatabase;
  let mockDocumentModel: any;
  let mockFileModel: any;
  let mockFileService: any;
  const userId = 'test-user-id';

  beforeEach(() => {
    mockDb = {
      query: {
        documents: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        files: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
    } as any;

    mockDocumentModel = {
      create: vi.fn(),
      delete: vi.fn(),
      findById: vi.fn(),
      query: vi.fn(),
      update: vi.fn(),
    };

    mockFileModel = {
      create: vi.fn(),
      delete: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
    };

    mockFileService = {
      downloadFileToLocal: vi.fn(),
    };

    vi.mocked(DocumentModel).mockImplementation(() => mockDocumentModel);
    vi.mocked(FileModel).mockImplementation(() => mockFileModel);
    vi.mocked(FileService).mockImplementation(() => mockFileService);

    service = new DocumentService(mockDb, userId);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createDocument', () => {
    it('should create a document without knowledgeBase', async () => {
      const mockDoc = { id: 'doc-1', title: 'Test Doc' };
      mockDocumentModel.create.mockResolvedValue(mockDoc);

      const result = await service.createDocument({
        title: 'Test Doc',
        editorData: { blocks: [] },
        content: 'Hello world',
      });

      expect(result).toEqual(mockDoc);
      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test Doc',
          filename: 'Test Doc',
          content: 'Hello world',
          totalCharCount: 'Hello world'.length,
          totalLineCount: 1,
          fileId: null,
          source: 'document',
          sourceType: 'api',
        }),
      );
      // Should not create a file record when no knowledgeBaseId
      expect(mockFileModel.create).not.toHaveBeenCalled();
    });

    it('should calculate character and line counts correctly', async () => {
      const content = 'line1\nline2\nline3';
      mockDocumentModel.create.mockResolvedValue({ id: 'doc-1' });

      await service.createDocument({
        title: 'Test',
        editorData: {},
        content,
      });

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          totalCharCount: content.length,
          totalLineCount: 3,
        }),
      );
    });

    it('should handle empty content with 0 counts', async () => {
      mockDocumentModel.create.mockResolvedValue({ id: 'doc-1' });

      await service.createDocument({
        title: 'Test',
        editorData: {},
      });

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          totalCharCount: 0,
          totalLineCount: 0,
        }),
      );
    });

    it('should create a file record when knowledgeBaseId is provided and fileType is not folder', async () => {
      const mockFile = { id: 'file-1' };
      const mockDoc = { id: 'doc-1', title: 'Test' };
      mockFileModel.create.mockResolvedValue(mockFile);
      mockDocumentModel.create.mockResolvedValue(mockDoc);

      const result = await service.createDocument({
        title: 'Test',
        editorData: {},
        content: 'Content',
        knowledgeBaseId: 'kb-1',
      });

      expect(mockFileModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test',
          knowledgeBaseId: 'kb-1',
          fileType: 'custom/document',
          url: 'internal://document/placeholder',
          size: 'Content'.length,
        }),
        false,
      );
      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'file-1',
          knowledgeBaseId: 'kb-1',
        }),
      );
      expect(result).toEqual(mockDoc);
    });

    it('should NOT create a file record when fileType is custom/folder', async () => {
      const mockDoc = { id: 'doc-1', title: 'My Folder' };
      mockDocumentModel.create.mockResolvedValue(mockDoc);

      await service.createDocument({
        title: 'My Folder',
        editorData: {},
        knowledgeBaseId: 'kb-1',
        fileType: 'custom/folder',
      });

      expect(mockFileModel.create).not.toHaveBeenCalled();
      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: null,
          fileType: 'custom/folder',
          // folders store knowledgeBaseId in metadata
          metadata: { knowledgeBaseId: 'kb-1' },
        }),
      );
    });

    it('should store knowledgeBaseId in metadata for folders', async () => {
      mockDocumentModel.create.mockResolvedValue({ id: 'doc-1' });

      await service.createDocument({
        title: 'Folder',
        editorData: {},
        knowledgeBaseId: 'kb-1',
        fileType: 'custom/folder',
        metadata: { existingKey: 'value' },
      });

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { existingKey: 'value', knowledgeBaseId: 'kb-1' },
        }),
      );
    });

    it('should use custom fileType when provided', async () => {
      mockDocumentModel.create.mockResolvedValue({ id: 'doc-1' });
      mockFileModel.create.mockResolvedValue({ id: 'file-1' });

      await service.createDocument({
        title: 'PDF Doc',
        editorData: {},
        knowledgeBaseId: 'kb-1',
        fileType: 'application/pdf',
      });

      expect(mockFileModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ fileType: 'application/pdf' }),
        false,
      );
    });

    it('should pass slug and parentId to document model', async () => {
      mockDocumentModel.create.mockResolvedValue({ id: 'doc-1' });

      await service.createDocument({
        title: 'Test',
        editorData: {},
        slug: 'my-slug',
        parentId: 'parent-doc-id',
      });

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: 'my-slug',
          parentId: 'parent-doc-id',
        }),
      );
    });
  });

  describe('createDocuments', () => {
    it('should create multiple documents in parallel', async () => {
      const docs = [
        { title: 'Doc 1', editorData: {} },
        { title: 'Doc 2', editorData: {}, content: 'Content' },
      ];
      const mockResults = [{ id: 'doc-1' }, { id: 'doc-2' }];
      mockDocumentModel.create
        .mockResolvedValueOnce(mockResults[0])
        .mockResolvedValueOnce(mockResults[1]);

      const results = await service.createDocuments(docs);

      expect(results).toEqual(mockResults);
      expect(mockDocumentModel.create).toHaveBeenCalledTimes(2);
    });

    it('should return empty array for empty input', async () => {
      const results = await service.createDocuments([]);
      expect(results).toEqual([]);
      expect(mockDocumentModel.create).not.toHaveBeenCalled();
    });
  });

  describe('queryDocuments', () => {
    it('should delegate to documentModel.query with no params', async () => {
      const mockResult = { items: [], total: 0 };
      mockDocumentModel.query.mockResolvedValue(mockResult);

      const result = await service.queryDocuments();

      expect(result).toEqual(mockResult);
      expect(mockDocumentModel.query).toHaveBeenCalledWith(undefined);
    });

    it('should delegate to documentModel.query with params', async () => {
      const params = { current: 1, pageSize: 10, fileTypes: ['pdf'] };
      const mockResult = { items: [{ id: 'doc-1' }], total: 1 };
      mockDocumentModel.query.mockResolvedValue(mockResult);

      const result = await service.queryDocuments(params);

      expect(result).toEqual(mockResult);
      expect(mockDocumentModel.query).toHaveBeenCalledWith(params);
    });
  });

  describe('getDocumentById', () => {
    it('should delegate to documentModel.findById', async () => {
      const mockDoc = { id: 'doc-1', title: 'Test' };
      mockDocumentModel.findById.mockResolvedValue(mockDoc);

      const result = await service.getDocumentById('doc-1');

      expect(result).toEqual(mockDoc);
      expect(mockDocumentModel.findById).toHaveBeenCalledWith('doc-1');
    });

    it('should return undefined when document not found', async () => {
      mockDocumentModel.findById.mockResolvedValue(undefined);

      const result = await service.getDocumentById('non-existent');

      expect(result).toBeUndefined();
    });
  });

  describe('deleteDocument', () => {
    it('should return early if document not found', async () => {
      mockDocumentModel.findById.mockResolvedValue(undefined);

      await service.deleteDocument('non-existent');

      expect(mockDocumentModel.delete).not.toHaveBeenCalled();
      expect(mockFileModel.delete).not.toHaveBeenCalled();
    });

    it('should delete a simple document without fileId', async () => {
      mockDocumentModel.findById.mockResolvedValue({
        id: 'doc-1',
        fileType: 'custom/document',
        fileId: null,
      });
      mockDocumentModel.delete.mockResolvedValue(undefined);

      await service.deleteDocument('doc-1');

      expect(mockFileModel.delete).not.toHaveBeenCalled();
      expect(mockDocumentModel.delete).toHaveBeenCalledWith('doc-1');
    });

    it('should delete a simple document and its associated file', async () => {
      mockDocumentModel.findById.mockResolvedValue({
        id: 'doc-1',
        fileType: 'custom/document',
        fileId: 'file-1',
      });
      mockDocumentModel.delete.mockResolvedValue(undefined);
      mockFileModel.delete.mockResolvedValue(undefined);

      await service.deleteDocument('doc-1');

      expect(mockFileModel.delete).toHaveBeenCalledWith('file-1');
      expect(mockDocumentModel.delete).toHaveBeenCalledWith('doc-1');
    });

    it('should recursively delete children when deleting a folder', async () => {
      // Folder has two children: one regular doc and one folder
      mockDocumentModel.findById
        .mockResolvedValueOnce({ id: 'folder-1', fileType: 'custom/folder', fileId: null })
        .mockResolvedValueOnce({
          id: 'child-doc-1',
          fileType: 'custom/document',
          fileId: 'file-child-1',
        })
        .mockResolvedValueOnce({ id: 'child-folder-2', fileType: 'custom/folder', fileId: null });

      // First call: children of folder-1
      (mockDb.query as any).documents.findMany
        .mockResolvedValueOnce([{ id: 'child-doc-1' }, { id: 'child-folder-2' }])
        // Second call: children of child-folder-2 (empty)
        .mockResolvedValueOnce([]);

      // Files in each folder
      (mockDb.query as any).files.findMany
        .mockResolvedValueOnce([]) // files in folder-1
        .mockResolvedValueOnce([]); // files in child-folder-2

      await service.deleteDocument('folder-1');

      // Should have deleted child-doc-1's associated file
      expect(mockFileModel.delete).toHaveBeenCalledWith('file-child-1');
      // Should have deleted all documents
      expect(mockDocumentModel.delete).toHaveBeenCalledWith('child-doc-1');
      expect(mockDocumentModel.delete).toHaveBeenCalledWith('child-folder-2');
      expect(mockDocumentModel.delete).toHaveBeenCalledWith('folder-1');
    });

    it('should delete files in folder when folder has associated files', async () => {
      mockDocumentModel.findById.mockResolvedValue({
        id: 'folder-1',
        fileType: 'custom/folder',
        fileId: null,
      });
      (mockDb.query as any).documents.findMany.mockResolvedValue([]);
      (mockDb.query as any).files.findMany.mockResolvedValue([
        { id: 'file-in-folder-1' },
        { id: 'file-in-folder-2' },
      ]);

      await service.deleteDocument('folder-1');

      expect(mockFileModel.delete).toHaveBeenCalledWith('file-in-folder-1');
      expect(mockFileModel.delete).toHaveBeenCalledWith('file-in-folder-2');
      expect(mockDocumentModel.delete).toHaveBeenCalledWith('folder-1');
    });
  });

  describe('deleteDocuments', () => {
    it('should delete multiple documents in parallel', async () => {
      mockDocumentModel.findById
        .mockResolvedValueOnce({ id: 'doc-1', fileType: 'custom/document', fileId: null })
        .mockResolvedValueOnce({ id: 'doc-2', fileType: 'custom/document', fileId: 'file-2' });

      await service.deleteDocuments(['doc-1', 'doc-2']);

      expect(mockDocumentModel.delete).toHaveBeenCalledWith('doc-1');
      expect(mockDocumentModel.delete).toHaveBeenCalledWith('doc-2');
      expect(mockFileModel.delete).toHaveBeenCalledWith('file-2');
    });

    it('should handle empty ids array', async () => {
      await service.deleteDocuments([]);
      expect(mockDocumentModel.findById).not.toHaveBeenCalled();
    });
  });

  describe('updateDocument', () => {
    it('should update content and recalculate char/line counts', async () => {
      const newContent = 'Updated\nContent';
      mockDocumentModel.update.mockResolvedValue({ id: 'doc-1' });
      mockDocumentModel.findById.mockResolvedValue({ id: 'doc-1', fileId: null });

      await service.updateDocument('doc-1', { content: newContent });

      expect(mockDocumentModel.update).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({
          content: newContent,
          totalCharCount: newContent.length,
          totalLineCount: 2,
        }),
      );
    });

    it('should update editorData', async () => {
      const editorData = { blocks: [{ type: 'paragraph', text: 'Hello' }] };
      mockDocumentModel.update.mockResolvedValue({ id: 'doc-1' });
      mockDocumentModel.findById.mockResolvedValue({ id: 'doc-1', fileId: null });

      await service.updateDocument('doc-1', { editorData });

      expect(mockDocumentModel.update).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({ editorData }),
      );
    });

    it('should update title and filename together', async () => {
      mockDocumentModel.update.mockResolvedValue({ id: 'doc-1' });
      mockDocumentModel.findById.mockResolvedValue({ id: 'doc-1', fileId: null });

      await service.updateDocument('doc-1', { title: 'New Title' });

      expect(mockDocumentModel.update).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({
          title: 'New Title',
          filename: 'New Title',
        }),
      );
    });

    it('should sync title update to associated file', async () => {
      mockDocumentModel.update.mockResolvedValue({ id: 'doc-1' });
      mockDocumentModel.findById.mockResolvedValue({ id: 'doc-1', fileId: 'file-1' });
      mockFileModel.update.mockResolvedValue(undefined);

      await service.updateDocument('doc-1', { title: 'New Title' });

      expect(mockFileModel.update).toHaveBeenCalledWith('file-1', { name: 'New Title' });
    });

    it('should sync parentId update to associated file', async () => {
      mockDocumentModel.update.mockResolvedValue({ id: 'doc-1' });
      mockDocumentModel.findById.mockResolvedValue({ id: 'doc-1', fileId: 'file-1' });
      mockFileModel.update.mockResolvedValue(undefined);

      await service.updateDocument('doc-1', { parentId: 'new-parent' });

      expect(mockFileModel.update).toHaveBeenCalledWith('file-1', { parentId: 'new-parent' });
    });

    it('should sync both title and parentId to file when both are updated', async () => {
      mockDocumentModel.update.mockResolvedValue({ id: 'doc-1' });
      mockDocumentModel.findById.mockResolvedValue({ id: 'doc-1', fileId: 'file-1' });
      mockFileModel.update.mockResolvedValue(undefined);

      await service.updateDocument('doc-1', { title: 'New Title', parentId: 'new-parent' });

      expect(mockFileModel.update).toHaveBeenCalledWith('file-1', {
        name: 'New Title',
        parentId: 'new-parent',
      });
    });

    it('should NOT update file when document has no associated file', async () => {
      mockDocumentModel.update.mockResolvedValue({ id: 'doc-1' });
      mockDocumentModel.findById.mockResolvedValue({ id: 'doc-1', fileId: null });

      await service.updateDocument('doc-1', { title: 'New Title' });

      expect(mockFileModel.update).not.toHaveBeenCalled();
    });

    it('should update metadata', async () => {
      const metadata = { key: 'value' };
      mockDocumentModel.update.mockResolvedValue({ id: 'doc-1' });
      mockDocumentModel.findById.mockResolvedValue({ id: 'doc-1', fileId: null });

      await service.updateDocument('doc-1', { metadata });

      expect(mockDocumentModel.update).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({ metadata }),
      );
    });

    it('should update fileType', async () => {
      mockDocumentModel.update.mockResolvedValue({ id: 'doc-1' });
      mockDocumentModel.findById.mockResolvedValue({ id: 'doc-1', fileId: null });

      await service.updateDocument('doc-1', { fileType: 'text/markdown' });

      expect(mockDocumentModel.update).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({ fileType: 'text/markdown' }),
      );
    });

    it('should handle parentId null (moving to root)', async () => {
      mockDocumentModel.update.mockResolvedValue({ id: 'doc-1' });
      mockDocumentModel.findById.mockResolvedValue({ id: 'doc-1', fileId: 'file-1' });
      mockFileModel.update.mockResolvedValue(undefined);

      await service.updateDocument('doc-1', { parentId: null });

      expect(mockFileModel.update).toHaveBeenCalledWith('file-1', { parentId: null });
    });
  });

  describe('parseDocument', () => {
    const mockCleanup = vi.fn();

    beforeEach(() => {
      mockFileService.downloadFileToLocal.mockResolvedValue({
        filePath: '/tmp/test.txt',
        file: { name: 'test.pdf', url: 's3://bucket/test.pdf', parentId: 'parent-id' },
        cleanup: mockCleanup,
      });
    });

    it('should parse a document file and create document record', async () => {
      vi.mocked(loadFile).mockResolvedValue({
        content: 'Parsed content',
        fileType: 'pdf',
        metadata: { title: 'My Doc' },
        pages: undefined,
        totalCharCount: 14,
        totalLineCount: 1,
      } as any);
      mockDocumentModel.create.mockResolvedValue({ id: 'doc-1', title: 'My Doc' });

      const result = await service.parseDocument('file-1');

      expect(loadFile).toHaveBeenCalledWith('/tmp/test.txt');
      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Parsed content',
          fileId: 'file-1',
          fileType: 'custom/document',
          filename: 'My Doc',
          title: 'My Doc',
          totalCharCount: 'Parsed content'.length,
          totalLineCount: 1,
          parentId: 'parent-id',
          source: 's3://bucket/test.pdf',
          sourceType: 'file',
        }),
      );
      expect(mockCleanup).toHaveBeenCalled();
      expect(result).toEqual({ id: 'doc-1', title: 'My Doc' });
    });

    it('should use filename as title when metadata has no title', async () => {
      vi.mocked(loadFile).mockResolvedValue({
        content: 'Content',
        fileType: 'pdf',
        metadata: {},
        pages: undefined,
        totalCharCount: 7,
        totalLineCount: 1,
      } as any);
      mockDocumentModel.create.mockResolvedValue({ id: 'doc-1' });
      mockFileService.downloadFileToLocal.mockResolvedValue({
        filePath: '/tmp/document.pdf',
        file: { name: 'document.pdf', url: 's3://bucket/doc.pdf', parentId: null },
        cleanup: mockCleanup,
      });

      await service.parseDocument('file-1');

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'document' }),
      );
    });

    it('should strip <page> tags from content', async () => {
      vi.mocked(loadFile).mockResolvedValue({
        content: '<page number="1">Page one content</page><page number="2">Page two content</page>',
        fileType: 'pdf',
        metadata: {},
        pages: undefined,
        totalCharCount: 32,
        totalLineCount: 1,
      } as any);
      mockDocumentModel.create.mockResolvedValue({ id: 'doc-1' });
      mockFileService.downloadFileToLocal.mockResolvedValue({
        filePath: '/tmp/doc.pdf',
        file: { name: 'doc.pdf', url: 's3://bucket/doc.pdf', parentId: null },
        cleanup: mockCleanup,
      });

      await service.parseDocument('file-1');

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Page one contentPage two content',
        }),
      );
    });

    it('should call cleanup even when parsing fails', async () => {
      vi.mocked(loadFile).mockRejectedValue(new Error('Parse error'));

      await expect(service.parseDocument('file-1')).rejects.toThrow('Parse error');

      expect(mockCleanup).toHaveBeenCalled();
    });
  });

  describe('parseFile', () => {
    const mockCleanup = vi.fn();

    beforeEach(() => {
      mockFileService.downloadFileToLocal.mockResolvedValue({
        filePath: '/tmp/test.md',
        file: { name: 'readme.md', url: 's3://bucket/readme.md', parentId: null },
        cleanup: mockCleanup,
      });
    });

    it('should parse a file and create document record with pages', async () => {
      vi.mocked(loadFile).mockResolvedValue({
        content: 'Full file content',
        fileType: 'markdown',
        metadata: { title: 'Readme' },
        pages: [{ content: 'Page 1' }],
        totalCharCount: 17,
        totalLineCount: 1,
      } as any);
      mockDocumentModel.create.mockResolvedValue({ id: 'doc-1', title: 'Readme' });

      const result = await service.parseFile('file-1');

      expect(loadFile).toHaveBeenCalledWith('/tmp/test.md');
      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Full file content',
          fileId: 'file-1',
          fileType: 'custom/document',
          filename: 'Readme',
          title: 'Readme',
          pages: [{ content: 'Page 1' }],
          totalCharCount: 17,
          totalLineCount: 1,
          source: 's3://bucket/readme.md',
          sourceType: 'file',
        }),
      );
      expect(mockCleanup).toHaveBeenCalled();
      expect(result).toEqual({ id: 'doc-1', title: 'Readme' });
    });

    it('should use file name as title (stripping extension) when metadata has no title', async () => {
      vi.mocked(loadFile).mockResolvedValue({
        content: 'Content',
        fileType: 'markdown',
        metadata: {},
        pages: undefined,
        totalCharCount: 7,
        totalLineCount: 1,
      } as any);
      mockDocumentModel.create.mockResolvedValue({ id: 'doc-1' });

      await service.parseFile('file-1');

      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'readme' }),
      );
    });

    it('should call cleanup even when file parsing fails', async () => {
      vi.mocked(loadFile).mockRejectedValue(new Error('File not parseable'));

      await expect(service.parseFile('file-1')).rejects.toThrow('File not parseable');

      expect(mockCleanup).toHaveBeenCalled();
    });

    it('should NOT strip page tags in parseFile (unlike parseDocument)', async () => {
      const contentWithPageTags =
        '<page number="1">First page</page><page number="2">Second page</page>';
      vi.mocked(loadFile).mockResolvedValue({
        content: contentWithPageTags,
        fileType: 'pdf',
        metadata: {},
        pages: undefined,
        totalCharCount: contentWithPageTags.length,
        totalLineCount: 1,
      } as any);
      mockDocumentModel.create.mockResolvedValue({ id: 'doc-1' });
      mockFileService.downloadFileToLocal.mockResolvedValue({
        filePath: '/tmp/doc.pdf',
        file: { name: 'doc.pdf', url: 's3://bucket/doc.pdf', parentId: null },
        cleanup: mockCleanup,
      });

      await service.parseFile('file-1');

      // parseFile does NOT strip page tags, unlike parseDocument
      expect(mockDocumentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: contentWithPageTags,
        }),
      );
    });
  });
});
