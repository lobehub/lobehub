// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AgentDocumentModel,
  buildDocumentFilename,
  extractMarkdownH1Title,
} from '@/database/models/agentDocuments';
import { TopicDocumentModel } from '@/database/models/topicDocument';
import type { LobeChatDatabase } from '@/database/type';

import { AgentDocumentsService } from './agentDocuments';
import { DocumentService } from './document';

const headlessEditorMocks = vi.hoisted(() => ({
  applyLiteXML: vi.fn(),
  applyLiteXMLBatch: vi.fn(),
}));

vi.mock('@/database/models/agentDocuments', () => ({
  AgentDocumentModel: vi.fn(),
  DocumentLoadPosition: {
    BEFORE_FIRST_USER: 'before_first_user',
  },
  buildDocumentFilename: vi.fn(),
  extractMarkdownH1Title: vi.fn((content: string) => ({ content })),
}));

vi.mock('@/database/models/topicDocument', () => ({
  TopicDocumentModel: vi.fn(),
}));

vi.mock('./document', () => ({
  DocumentService: vi.fn(),
}));

vi.mock('@lobehub/editor/headless', () => ({
  createHeadlessEditor: vi.fn(() => {
    let markdown = '';
    let litexml = '<p id="node-1">content</p>';

    return {
      applyLiteXML: vi.fn(async (operations) => {
        headlessEditorMocks.applyLiteXML(operations);
        markdown = 'xml updated';
        litexml = '<p id="node-1">xml updated</p>';
      }),
      applyLiteXMLBatch: vi.fn(async (operations) => {
        headlessEditorMocks.applyLiteXMLBatch(operations);
        markdown = 'xml updated';
        litexml = '<p id="node-1">xml updated</p>';
      }),
      destroy: vi.fn(),
      export: vi.fn((options?: { litexml?: boolean }) => ({
        editorData: { root: { children: [] } },
        litexml: options?.litexml ? litexml : undefined,
        markdown,
      })),
      hydrateEditorData: vi.fn(() => {
        markdown = 'projected';
      }),
      hydrateMarkdown: vi.fn((content: string) => {
        markdown = content;
      }),
    };
  }),
}));

describe('AgentDocumentsService', () => {
  const db = {} as LobeChatDatabase;
  const userId = 'user-1';

  const mockModel = {
    associate: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    findByAgent: vi.fn(),
    findByDocumentIds: vi.fn(),
    findByFilename: vi.fn(),
    hasByAgent: vi.fn(),
    rename: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  };
  const mockDocumentService = {
    trySaveCurrentDocumentHistory: vi.fn(),
  };
  const mockTopicDocumentModel = {
    associate: vi.fn(),
    findByTopicId: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (AgentDocumentModel as any).mockImplementation(() => mockModel);
    (DocumentService as any).mockImplementation(() => mockDocumentService);
    (TopicDocumentModel as any).mockImplementation(() => mockTopicDocumentModel);
    vi.mocked(buildDocumentFilename).mockImplementation((title: string) => title);
    vi.mocked(extractMarkdownH1Title).mockImplementation((content: string) => ({ content }));
  });

  describe('createDocument', () => {
    it('should append a numeric suffix when the base filename already exists', async () => {
      mockModel.findByFilename
        .mockResolvedValueOnce({ id: 'existing-doc' })
        .mockResolvedValueOnce(undefined);
      mockModel.create.mockResolvedValue({ id: 'new-doc', filename: 'note-2' });

      const service = new AgentDocumentsService(db, userId);
      const result = await service.createDocument('agent-1', 'note', 'content');

      expect(mockModel.findByFilename).toHaveBeenNthCalledWith(1, 'agent-1', 'note');
      expect(mockModel.findByFilename).toHaveBeenNthCalledWith(2, 'agent-1', 'note-2');
      expect(mockModel.create).toHaveBeenCalledWith('agent-1', 'note-2', 'content', {
        editorData: { root: { children: [] } },
        title: 'note',
      });
      expect(result).toEqual({ id: 'new-doc', filename: 'note-2' });
    });

    it('should throw after too many filename collisions', async () => {
      mockModel.findByFilename.mockResolvedValue({ id: 'existing-doc' });

      const service = new AgentDocumentsService(db, userId);

      await expect(service.createDocument('agent-1', 'note', 'content')).rejects.toThrow(
        'Unable to generate a unique filename for "note" after 1000 attempts.',
      );
      expect(mockModel.create).not.toHaveBeenCalled();
    });

    it('should extract H1 from markdown content as the document title', async () => {
      vi.mocked(extractMarkdownH1Title).mockReturnValueOnce({
        content: 'body',
        title: 'My Title',
      });
      mockModel.findByFilename.mockResolvedValue(undefined);
      mockModel.create.mockResolvedValue({ id: 'new-doc', filename: 'My Title' });

      const service = new AgentDocumentsService(db, userId);
      await service.createDocument('agent-1', 'fallback', '# My Title\n\nbody');

      expect(vi.mocked(buildDocumentFilename)).toHaveBeenCalledWith('My Title');
      expect(mockModel.create).toHaveBeenCalledWith('agent-1', 'My Title', 'body', {
        editorData: { root: { children: [] } },
        title: 'My Title',
      });
    });
  });

  describe('createForTopic', () => {
    it('should create an agent document and associate the underlying document with the topic', async () => {
      mockModel.findByFilename.mockResolvedValue(undefined);
      mockModel.create.mockResolvedValue({
        documentId: 'documents-1',
        filename: 'note',
        id: 'agent-doc-1',
        title: 'note',
      });

      const service = new AgentDocumentsService(db, userId);
      const result = await service.createForTopic('agent-1', 'note', 'content', 'topic-1');

      expect(result).toEqual({
        documentId: 'documents-1',
        filename: 'note',
        id: 'agent-doc-1',
        title: 'note',
      });
      expect(mockTopicDocumentModel.associate).toHaveBeenCalledWith({
        documentId: 'documents-1',
        topicId: 'topic-1',
      });
    });
  });

  describe('listDocuments', () => {
    it('should return a list of documents with documentId, filename, id, and title', async () => {
      mockModel.findByAgent.mockResolvedValue([
        {
          content: 'c1',
          documentId: 'documents-1',
          filename: 'a.md',
          id: 'doc-1',
          policy: null,
          title: 'A',
        },
        {
          content: 'c2',
          documentId: 'documents-2',
          filename: 'b.md',
          id: 'doc-2',
          policy: null,
          title: 'B',
        },
      ]);

      const service = new AgentDocumentsService(db, userId);
      const result = await service.listDocuments('agent-1');

      expect(mockModel.findByAgent).toHaveBeenCalledWith('agent-1');
      expect(result).toEqual([
        {
          documentId: 'documents-1',
          filename: 'a.md',
          id: 'doc-1',
          loadPosition: undefined,
          title: 'A',
        },
        {
          documentId: 'documents-2',
          filename: 'b.md',
          id: 'doc-2',
          loadPosition: undefined,
          title: 'B',
        },
      ]);
    });
  });

  describe('listDocumentsForTopic', () => {
    it('should list only agent documents associated with the topic and preserve topic order', async () => {
      mockTopicDocumentModel.findByTopicId.mockResolvedValue([
        { id: 'documents-2', title: 'B' },
        { id: 'documents-1', title: 'A' },
      ]);
      mockModel.findByDocumentIds.mockResolvedValue([
        {
          documentId: 'documents-1',
          filename: 'a.md',
          id: 'agent-doc-1',
          policy: null,
          title: 'A',
        },
        {
          documentId: 'documents-2',
          filename: 'b.md',
          id: 'agent-doc-2',
          policy: null,
          title: 'B',
        },
      ]);

      const service = new AgentDocumentsService(db, userId);
      const result = await service.listDocumentsForTopic('agent-1', 'topic-1');

      expect(mockTopicDocumentModel.findByTopicId).toHaveBeenCalledWith('topic-1');
      expect(mockModel.findByDocumentIds).toHaveBeenCalledWith('agent-1', [
        'documents-2',
        'documents-1',
      ]);
      expect(result).toEqual([
        {
          documentId: 'documents-2',
          filename: 'b.md',
          id: 'agent-doc-2',
          loadPosition: undefined,
          title: 'B',
        },
        {
          documentId: 'documents-1',
          filename: 'a.md',
          id: 'agent-doc-1',
          loadPosition: undefined,
          title: 'A',
        },
      ]);
    });
  });

  describe('getDocumentByFilename', () => {
    it('should read a document by filename', async () => {
      mockModel.findByFilename.mockResolvedValue({
        content: 'hello',
        filename: 'note.md',
        id: 'doc-1',
        title: 'note',
      });

      const service = new AgentDocumentsService(db, userId);
      const result = await service.getDocumentByFilename('agent-1', 'note.md');

      expect(mockModel.findByFilename).toHaveBeenCalledWith('agent-1', 'note.md');
      expect(result).toEqual({
        content: 'hello',
        filename: 'note.md',
        id: 'doc-1',
        title: 'note',
      });
    });

    it('should return undefined when filename does not exist', async () => {
      mockModel.findByFilename.mockResolvedValue(undefined);

      const service = new AgentDocumentsService(db, userId);
      const result = await service.getDocumentByFilename('agent-1', 'missing.md');

      expect(result).toBeUndefined();
    });
  });

  describe('getDocumentSnapshotById', () => {
    it('should fall back to markdown content when editor data is empty', async () => {
      mockModel.findById.mockResolvedValue({
        agentId: 'agent-1',
        content: 'fallback content',
        editorData: { root: { children: [] } },
        id: 'agent-doc-1',
        title: 'Doc',
      });

      const service = new AgentDocumentsService(db, userId);
      const result = await service.getDocumentSnapshotById('agent-doc-1', 'agent-1');

      expect(result).toEqual({
        agentId: 'agent-1',
        content: 'fallback content',
        editorData: { root: { children: [] } },
        id: 'agent-doc-1',
        litexml: '<p id="node-1">content</p>',
        title: 'Doc',
      });
    });
  });

  describe('upsertDocumentByFilename', () => {
    it('should create or update a document by filename', async () => {
      mockModel.findByFilename.mockResolvedValue(undefined);
      mockModel.upsert.mockResolvedValue({ content: 'new', filename: 'f.md', id: 'doc-1' });

      const service = new AgentDocumentsService(db, userId);
      const result = await service.upsertDocumentByFilename({
        agentId: 'agent-1',
        content: 'new',
        filename: 'f.md',
      });

      expect(mockModel.upsert).toHaveBeenCalledWith('agent-1', 'f.md', 'new', {
        editorData: { root: { children: [] } },
      });
      expect(result).toEqual({ content: 'new', filename: 'f.md', id: 'doc-1' });
    });

    it('should save history before updating an existing document by filename', async () => {
      mockModel.findByFilename.mockResolvedValue({
        agentId: 'agent-1',
        content: 'old',
        documentId: 'documents-1',
        filename: 'f.md',
        id: 'agent-doc-1',
      });
      mockModel.upsert.mockResolvedValue({ content: 'new', filename: 'f.md', id: 'agent-doc-1' });

      const service = new AgentDocumentsService(db, userId);
      await service.upsertDocumentByFilename({
        agentId: 'agent-1',
        content: 'new',
        filename: 'f.md',
      });

      expect(mockDocumentService.trySaveCurrentDocumentHistory).toHaveBeenCalledWith(
        'documents-1',
        'llm_call',
      );
      expect(
        mockDocumentService.trySaveCurrentDocumentHistory.mock.invocationCallOrder[0],
      ).toBeLessThan(mockModel.upsert.mock.invocationCallOrder[0]);
    });

    it('should skip history when upsert content is unchanged', async () => {
      mockModel.findByFilename.mockResolvedValue({
        agentId: 'agent-1',
        content: 'same',
        documentId: 'documents-1',
        filename: 'f.md',
        id: 'agent-doc-1',
      });
      mockModel.upsert.mockResolvedValue({ content: 'same', filename: 'f.md', id: 'agent-doc-1' });

      const service = new AgentDocumentsService(db, userId);
      await service.upsertDocumentByFilename({
        agentId: 'agent-1',
        content: 'same',
        filename: 'f.md',
      });

      expect(mockDocumentService.trySaveCurrentDocumentHistory).not.toHaveBeenCalled();
    });
  });

  describe('editDocumentById', () => {
    it('should save history before editing document content', async () => {
      mockModel.findById
        .mockResolvedValueOnce({
          agentId: 'agent-1',
          content: 'old',
          documentId: 'documents-1',
          id: 'agent-doc-1',
          title: 'Doc',
        })
        .mockResolvedValueOnce({
          agentId: 'agent-1',
          content: 'new',
          documentId: 'documents-1',
          id: 'agent-doc-1',
          title: 'Doc',
        });

      const service = new AgentDocumentsService(db, userId);
      const result = await service.editDocumentById('agent-doc-1', 'new', 'agent-1');

      expect(mockDocumentService.trySaveCurrentDocumentHistory).toHaveBeenCalledWith(
        'documents-1',
        'llm_call',
      );
      expect(mockModel.update).toHaveBeenCalledWith('agent-doc-1', {
        content: 'new',
        editorData: { root: { children: [] } },
      });
      expect(
        mockDocumentService.trySaveCurrentDocumentHistory.mock.invocationCallOrder[0],
      ).toBeLessThan(mockModel.update.mock.invocationCallOrder[0]);
      expect(result).toEqual({
        agentId: 'agent-1',
        content: 'new',
        documentId: 'documents-1',
        id: 'agent-doc-1',
        title: 'Doc',
      });
    });

    it('should skip history when edited content is unchanged', async () => {
      mockModel.findById
        .mockResolvedValueOnce({
          agentId: 'agent-1',
          content: 'same',
          documentId: 'documents-1',
          id: 'agent-doc-1',
          title: 'Doc',
        })
        .mockResolvedValueOnce({
          agentId: 'agent-1',
          content: 'same',
          documentId: 'documents-1',
          id: 'agent-doc-1',
          title: 'Doc',
        });

      const service = new AgentDocumentsService(db, userId);
      await service.editDocumentById('agent-doc-1', 'same', 'agent-1');

      expect(mockDocumentService.trySaveCurrentDocumentHistory).not.toHaveBeenCalled();
      expect(mockModel.update).toHaveBeenCalledWith('agent-doc-1', {
        content: 'same',
        editorData: { root: { children: [] } },
      });
    });

    it('should apply LiteXML operations against editor data', async () => {
      mockModel.findById
        .mockResolvedValueOnce({
          agentId: 'agent-1',
          content: 'old',
          documentId: 'documents-1',
          editorData: { root: { children: [{ text: 'old' }] } },
          id: 'agent-doc-1',
          title: 'Doc',
        })
        .mockResolvedValueOnce({
          agentId: 'agent-1',
          content: 'xml updated',
          documentId: 'documents-1',
          editorData: { root: { children: [] } },
          id: 'agent-doc-1',
          title: 'Doc',
        });

      const service = new AgentDocumentsService(db, userId);
      const result = await service.modifyDocumentNodesById(
        'agent-doc-1',
        [{ action: 'modify', litexml: '<p id="node-1">xml updated</p>' }],
        'agent-1',
      );

      expect(mockDocumentService.trySaveCurrentDocumentHistory).toHaveBeenCalledWith(
        'documents-1',
        'llm_call',
      );
      expect(mockModel.update).toHaveBeenCalledWith('agent-doc-1', {
        content: 'xml updated',
        editorData: { root: { children: [] } },
      });
      expect(headlessEditorMocks.applyLiteXML).toHaveBeenCalledWith([
        {
          action: 'replace',
          delay: true,
          litexml: '<p id="node-1">xml updated</p>',
        },
      ]);
      expect(headlessEditorMocks.applyLiteXMLBatch).not.toHaveBeenCalled();
      expect(result?.content).toBe('xml updated');
    });
  });

  describe('renameDocumentById', () => {
    it('should save history before renaming a document', async () => {
      mockModel.findById.mockResolvedValue({
        agentId: 'agent-1',
        content: 'content',
        documentId: 'documents-1',
        id: 'agent-doc-1',
        title: 'Old title',
      });
      mockModel.rename.mockResolvedValue({
        agentId: 'agent-1',
        content: 'content',
        documentId: 'documents-1',
        id: 'agent-doc-1',
        title: 'New title',
      });

      const service = new AgentDocumentsService(db, userId);
      await service.renameDocumentById('agent-doc-1', 'New title', 'agent-1');

      expect(mockDocumentService.trySaveCurrentDocumentHistory).toHaveBeenCalledWith(
        'documents-1',
        'llm_call',
      );
      expect(
        mockDocumentService.trySaveCurrentDocumentHistory.mock.invocationCallOrder[0],
      ).toBeLessThan(mockModel.rename.mock.invocationCallOrder[0]);
    });
  });

  describe('hasDocuments', () => {
    it('should use the model existence check', async () => {
      mockModel.hasByAgent.mockResolvedValue(true);

      const service = new AgentDocumentsService(db, userId);
      const result = await service.hasDocuments('agent-1');

      expect(mockModel.hasByAgent).toHaveBeenCalledWith('agent-1');
      expect(result).toBe(true);
    });
  });

  describe('associateDocument', () => {
    it('should delegate to agentDocumentModel.associate', async () => {
      mockModel.associate.mockResolvedValue({ id: 'ad-1' });

      const service = new AgentDocumentsService(db, userId);
      const result = await service.associateDocument('agent-1', 'doc-1');

      expect(mockModel.associate).toHaveBeenCalledWith({ agentId: 'agent-1', documentId: 'doc-1' });
      expect(result).toEqual({ id: 'ad-1' });
    });
  });
});
