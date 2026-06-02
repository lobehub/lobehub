import type { LobeChatDatabase } from '@lobechat/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';

import { DocumentService } from '../../document';
import * as headlessEditor from '../../document/headlessEditor';
import { PersonalPagesService } from '../index';

vi.mock('@/database/models/document');
vi.mock('../../document');
vi.mock('../../document/headlessEditor', async (importOriginal) => {
  const actual = await importOriginal<typeof headlessEditor>();
  return {
    ...actual,
    applyLiteXMLOperations: vi.fn(),
    createMarkdownEditorSnapshot: vi.fn(),
    exportEditorDataSnapshot: vi.fn(),
  };
});

const mockEditorSnapshot = {
  content: 'Hello world',
  editorData: { root: { children: [], type: 'root' } },
  litexml: '<p id="1">Hello world</p>',
};

describe('PersonalPagesService', () => {
  let service: PersonalPagesService;
  let mockDb: LobeChatDatabase;
  let mockDocumentModel: any;
  let mockDocumentService: any;
  const userId = 'user-123';

  beforeEach(() => {
    mockDb = {} as any;

    mockDocumentModel = {
      create: vi.fn(),
      findById: vi.fn(),
      query: vi.fn(),
      update: vi.fn(),
    };

    mockDocumentService = {
      createDocument: vi.fn(),
      trySaveCurrentDocumentHistory: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(DocumentModel).mockImplementation(() => mockDocumentModel);
    vi.mocked(DocumentService).mockImplementation(() => mockDocumentService);

    service = new PersonalPagesService(mockDb, userId);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createPage', () => {
    it('calls documentService.createDocument with correct params', async () => {
      const mockDoc = { id: 'doc-1', title: 'My Page', content: 'Hello' };
      mockDocumentService.createDocument.mockResolvedValue(mockDoc);

      const result = await service.createPage('My Page', 'Hello');

      expect(mockDocumentService.createDocument).toHaveBeenCalledWith({
        content: 'Hello',
        editorData: {},
        fileType: 'custom/document',
        metadata: expect.objectContaining({ createdAt: expect.any(Number) }),
        title: 'My Page',
      });
      expect(result).toEqual(mockDoc);
    });

    it('does not set sourceType (server defaults to api)', async () => {
      mockDocumentService.createDocument.mockResolvedValue({ id: 'doc-1' });
      await service.createPage('Title', '');
      const callArg = mockDocumentService.createDocument.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('sourceType');
    });

    it('does not set knowledgeBaseId (personal page)', async () => {
      mockDocumentService.createDocument.mockResolvedValue({ id: 'doc-1' });
      await service.createPage('Title', '');
      const callArg = mockDocumentService.createDocument.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('knowledgeBaseId');
    });
  });

  describe('readPage', () => {
    it('returns undefined when document not found', async () => {
      mockDocumentModel.findById.mockResolvedValue(undefined);
      const result = await service.readPage('missing-id');
      expect(result).toBeUndefined();
    });

    it('enforces userId ownership via documentModel (findById filters by userId)', async () => {
      mockDocumentModel.findById.mockResolvedValue(undefined);
      await service.readPage('doc-1');
      expect(mockDocumentModel.findById).toHaveBeenCalledWith('doc-1');
    });

    it('returns snapshot with content from editorData when present', async () => {
      const doc = {
        content: 'original',
        editorData: { root: { children: [], type: 'root' } },
        id: 'doc-1',
        title: 'My Page',
      };
      mockDocumentModel.findById.mockResolvedValue(doc);
      vi.mocked(headlessEditor.exportEditorDataSnapshot).mockResolvedValue(mockEditorSnapshot);

      const result = await service.readPage('doc-1');

      expect(result).toMatchObject({
        content: 'Hello world',
        id: 'doc-1',
        title: 'My Page',
      });
    });

    it('does not expose editorData in the returned snapshot', async () => {
      const doc = {
        content: 'original',
        editorData: { root: { children: [], type: 'root' } },
        id: 'doc-1',
        title: 'My Page',
      };
      mockDocumentModel.findById.mockResolvedValue(doc);
      vi.mocked(headlessEditor.exportEditorDataSnapshot).mockResolvedValue(mockEditorSnapshot);

      const result = await service.readPage('doc-1');

      expect(result).not.toHaveProperty('editorData');
    });

    it('falls back to doc.content when exportEditorDataSnapshot returns empty', async () => {
      const doc = {
        content: 'fallback content',
        editorData: null,
        id: 'doc-1',
        title: 'Title',
      };
      mockDocumentModel.findById.mockResolvedValue(doc);
      vi.mocked(headlessEditor.exportEditorDataSnapshot).mockResolvedValue({
        content: '',
        editorData: {},
      });

      const result = await service.readPage('doc-1');

      expect(result?.content).toBe('fallback content');
    });

    it('passes litexml=true when format is xml', async () => {
      const doc = { content: 'c', editorData: null, id: 'doc-1', title: 'T' };
      mockDocumentModel.findById.mockResolvedValue(doc);
      vi.mocked(headlessEditor.exportEditorDataSnapshot).mockResolvedValue(mockEditorSnapshot);

      await service.readPage('doc-1', { format: 'xml' });

      expect(headlessEditor.exportEditorDataSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ litexml: true }),
      );
    });
  });

  describe('replaceContent', () => {
    it('returns undefined when document not found', async () => {
      mockDocumentModel.findById.mockResolvedValue(undefined);
      const result = await service.replaceContent('missing', 'content');
      expect(result).toBeUndefined();
    });

    it('calls trySaveCurrentDocumentHistory before updating when content differs', async () => {
      const doc = { content: 'old', editorData: null, id: 'doc-1', title: 'T' };
      mockDocumentModel.findById.mockResolvedValue(doc);
      vi.mocked(headlessEditor.createMarkdownEditorSnapshot).mockResolvedValue({
        content: 'new content',
        editorData: { root: { children: [], type: 'root' } },
      });
      vi.mocked(headlessEditor.exportEditorDataSnapshot).mockResolvedValue({
        content: 'new content',
        editorData: {},
      });

      await service.replaceContent('doc-1', 'new content');

      expect(mockDocumentService.trySaveCurrentDocumentHistory).toHaveBeenCalledWith(
        'doc-1',
        'llm_call',
      );
    });

    it('skips history save when content unchanged', async () => {
      const doc = { content: 'same', editorData: null, id: 'doc-1', title: 'T' };
      mockDocumentModel.findById.mockResolvedValue(doc);
      vi.mocked(headlessEditor.createMarkdownEditorSnapshot).mockResolvedValue({
        content: 'same',
        editorData: {},
      });
      vi.mocked(headlessEditor.exportEditorDataSnapshot).mockResolvedValue({
        content: 'same',
        editorData: {},
      });

      await service.replaceContent('doc-1', 'same');

      expect(mockDocumentService.trySaveCurrentDocumentHistory).not.toHaveBeenCalled();
    });

    it('updates documentModel with new content and editorData', async () => {
      const doc = { content: 'old', editorData: null, id: 'doc-1', title: 'T' };
      mockDocumentModel.findById.mockResolvedValue(doc);
      const snap = { content: 'new', editorData: { root: {} } };
      vi.mocked(headlessEditor.createMarkdownEditorSnapshot).mockResolvedValue(snap);
      vi.mocked(headlessEditor.exportEditorDataSnapshot).mockResolvedValue({
        content: 'new',
        editorData: {},
      });

      await service.replaceContent('doc-1', 'new');

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        content: 'new',
        editorData: { root: {} },
      });
    });
  });

  describe('modifyNodes', () => {
    it('returns undefined when document not found', async () => {
      mockDocumentModel.findById.mockResolvedValue(undefined);
      const result = await service.modifyNodes('missing', []);
      expect(result).toBeUndefined();
    });

    it('always calls trySaveCurrentDocumentHistory', async () => {
      const doc = { content: 'c', editorData: { root: {} }, id: 'doc-1', title: 'T' };
      mockDocumentModel.findById.mockResolvedValue(doc);
      vi.mocked(headlessEditor.applyLiteXMLOperations).mockResolvedValue({
        content: 'modified',
        editorData: {},
      });
      vi.mocked(headlessEditor.exportEditorDataSnapshot).mockResolvedValue({
        content: 'modified',
        editorData: {},
      });

      await service.modifyNodes('doc-1', [{ action: 'remove', id: 'node-1' }]);

      expect(mockDocumentService.trySaveCurrentDocumentHistory).toHaveBeenCalledWith(
        'doc-1',
        'llm_call',
      );
    });

    it('applies litexml operations and updates editorData', async () => {
      const doc = { content: 'c', editorData: { root: {} }, id: 'doc-1', title: 'T' };
      mockDocumentModel.findById.mockResolvedValue(doc);
      const snap = { content: 'result', editorData: { root: { updated: true } }, litexml: '<p/>' };
      vi.mocked(headlessEditor.applyLiteXMLOperations).mockResolvedValue(snap);
      vi.mocked(headlessEditor.exportEditorDataSnapshot).mockResolvedValue({
        content: 'result',
        editorData: {},
      });

      const ops = [{ action: 'remove' as const, id: 'n1' }];
      await service.modifyNodes('doc-1', ops);

      expect(headlessEditor.applyLiteXMLOperations).toHaveBeenCalledWith({
        editorData: { root: {} },
        fallbackContent: 'c',
        operations: ops,
      });
      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        content: 'result',
        editorData: { root: { updated: true } },
      });
    });
  });

  describe('listPages', () => {
    it('queries with editor-only fileTypes (no PDF)', async () => {
      mockDocumentModel.query.mockResolvedValue({ items: [], total: 0 });
      await service.listPages();
      expect(mockDocumentModel.query).toHaveBeenCalledWith({
        fileTypes: ['custom/document'],
      });
    });

    it('does not include application/pdf in queried fileTypes', async () => {
      mockDocumentModel.query.mockResolvedValue({ items: [], total: 0 });
      await service.listPages();
      const queryArg = mockDocumentModel.query.mock.calls[0][0];
      expect(queryArg.fileTypes).not.toContain('application/pdf');
    });

    it('excludes pages with knowledgeBaseId in metadata (library pages)', async () => {
      const personalPage = {
        fileType: 'custom/document',
        id: 'p1',
        metadata: {},
        title: 'Personal',
      };
      const libraryPage = {
        fileType: 'custom/document',
        id: 'p2',
        metadata: { knowledgeBaseId: 'kb-1' },
        title: 'Library',
      };
      mockDocumentModel.query.mockResolvedValue({ items: [personalPage, libraryPage], total: 2 });

      const result = await service.listPages();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('p1');
    });

    it('does not return a PDF document even when knowledgeBaseId is empty', async () => {
      const editorPage = { fileType: 'custom/document', id: 'p1', metadata: {}, title: 'Page' };
      const pdfDoc = { fileType: 'application/pdf', id: 'pdf1', metadata: {}, title: 'PDF' };
      mockDocumentModel.query.mockResolvedValue({ items: [editorPage], total: 1 });

      const result = await service.listPages();

      expect(mockDocumentModel.query).toHaveBeenCalledWith({ fileTypes: ['custom/document'] });
      expect(result.map((d) => d.id)).not.toContain(pdfDoc.id);
      expect(result.every((d) => d.fileType === 'custom/document')).toBe(true);
    });

    it('returns all pages when none have knowledgeBaseId', async () => {
      const pages = [
        { id: 'p1', metadata: null, title: 'A' },
        { id: 'p2', metadata: {}, title: 'B' },
        { id: 'p3', metadata: { otherKey: 'value' }, title: 'C' },
      ];
      mockDocumentModel.query.mockResolvedValue({ items: pages, total: 3 });

      const result = await service.listPages();

      expect(result).toHaveLength(3);
    });

    it('ownership is scoped by userId via DocumentModel constructor', () => {
      expect(vi.mocked(DocumentModel)).toHaveBeenCalledWith(mockDb, userId);
    });
  });
});
