// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import {
  AgentDocumentModel,
  buildDocumentFilename,
  extractMarkdownH1Title,
} from '@/database/models/agentDocuments';
import { AgentSkillModel } from '@/database/models/agentSkill';
import { TopicDocumentModel } from '@/database/models/topicDocument';
import type { LobeChatDatabase } from '@/database/type';

import { DocumentService } from '../document';
import { SkillResourceService } from '../skill/resource';
import { AgentDocumentsService } from './index';

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

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(),
}));

vi.mock('@/database/models/agentSkill', () => ({
  AgentSkillModel: vi.fn(),
}));

vi.mock('@/database/models/topicDocument', () => ({
  TopicDocumentModel: vi.fn(),
}));

vi.mock('../document', () => ({
  DocumentService: vi.fn(),
}));

vi.mock('../skill/resource', () => ({
  SkillResourceService: vi.fn(),
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
    copy: vi.fn(),
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
    createDocument: vi.fn(),
    deleteDocument: vi.fn(),
    trySaveCurrentDocumentHistory: vi.fn(),
    updateDocument: vi.fn(),
  };
  const mockAgentModel = {
    getAgentConfigById: vi.fn(),
  };
  const mockSkillModel = {
    findAll: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
  };
  const mockTopicDocumentModel = {
    associate: vi.fn(),
    findByTopicId: vi.fn(),
  };
  const mockSkillResourceService = {
    readResource: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (AgentDocumentModel as any).mockImplementation(() => mockModel);
    (AgentModel as any).mockImplementation(() => mockAgentModel);
    (AgentSkillModel as any).mockImplementation(() => mockSkillModel);
    (DocumentService as any).mockImplementation(() => mockDocumentService);
    (SkillResourceService as any).mockImplementation(() => mockSkillResourceService);
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

    it('should append collision suffix before the filename extension', async () => {
      mockModel.findByFilename
        .mockResolvedValueOnce({ id: 'existing-doc' })
        .mockResolvedValueOnce(undefined);
      mockModel.create.mockResolvedValue({ id: 'new-doc', filename: 'Untitled document-2.md' });

      const service = new AgentDocumentsService(db, userId);
      const result = await service.createDocument('agent-1', 'Untitled document.md', 'content');

      expect(mockModel.findByFilename).toHaveBeenNthCalledWith(
        1,
        'agent-1',
        'Untitled document.md',
      );
      expect(mockModel.findByFilename).toHaveBeenNthCalledWith(
        2,
        'agent-1',
        'Untitled document-2.md',
      );
      expect(mockModel.create).toHaveBeenCalledWith(
        'agent-1',
        'Untitled document-2.md',
        'content',
        {
          editorData: { root: { children: [] } },
          title: 'Untitled document.md',
        },
      );
      expect(result).toEqual({ id: 'new-doc', filename: 'Untitled document-2.md' });
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

    it('persists agent signal skill hints in document metadata', async () => {
      mockModel.findByFilename.mockResolvedValue(undefined);
      mockModel.create.mockResolvedValue({ id: 'new-doc', filename: 'Reusable Procedure' });

      const service = new AgentDocumentsService(db, userId);
      await service.createDocument('agent-1', 'Reusable Procedure', 'content', {
        hintIsSkill: true,
      });

      expect(mockModel.create).toHaveBeenCalledWith(
        'agent-1',
        expect.any(String),
        'content',
        expect.objectContaining({
          metadata: {
            agentSignal: {
              hintedByTool: 'lobe-agent-documents.createDocument',
              hintIsSkill: true,
            },
          },
        }),
      );
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

  describe('replaceDocumentContentById', () => {
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
      const result = await service.replaceDocumentContentById('agent-doc-1', 'new', 'agent-1');

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
      await service.replaceDocumentContentById('agent-doc-1', 'same', 'agent-1');

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

    it('should reject renaming skill-managed documents', async () => {
      mockModel.findById.mockResolvedValue({
        agentId: 'agent-1',
        content: 'content',
        documentId: 'documents-1',
        id: 'agent-doc-1',
        templateId: 'agent-skill',
        title: 'writer',
      });

      const service = new AgentDocumentsService(db, userId);

      await expect(service.renameDocumentById('agent-doc-1', 'renamed', 'agent-1')).rejects.toThrow(
        'Skill VFS documents must be renamed through skill-specific APIs',
      );
      expect(mockModel.rename).not.toHaveBeenCalled();
    });
  });

  describe('copyDocumentById', () => {
    it('should reject copying skill-managed documents', async () => {
      mockModel.findById.mockResolvedValue({
        agentId: 'agent-1',
        content: 'content',
        documentId: 'documents-1',
        id: 'agent-doc-1',
        templateId: 'agent-skill',
        title: 'SKILL.md',
      });

      const service = new AgentDocumentsService(db, userId);

      await expect(service.copyDocumentById('agent-doc-1', 'copy', 'agent-1')).rejects.toThrow(
        'Skill VFS documents must be copied through skill-specific APIs',
      );
      expect(mockModel.copy).not.toHaveBeenCalled();
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

  describe('getAgentSkills', () => {
    // Inject docs with the derive flags already set so we test the
    // bundle → index-child → identifier mapping in isolation, not the
    // model's deriveAgentDocumentFields projection.
    const stubDocs = (docs: Array<Partial<any>>): any[] =>
      docs.map((doc) => ({
        content: '',
        description: null,
        filename: '',
        isSkillBundle: false,
        isSkillIndex: false,
        parentId: null,
        title: null,
        ...doc,
      }));

    it('returns an empty list when the agent has no skill bundles', async () => {
      const service = new AgentDocumentsService(db, userId);
      vi.spyOn(service, 'getAgentDocuments').mockResolvedValue(
        stubDocs([
          { documentId: 'doc-1', filename: 'note.md', isSkillBundle: false },
          { documentId: 'doc-2', filename: 'web.md', isSkillBundle: false },
        ]),
      );

      const result = await service.getAgentSkills('agent-1');

      expect(service.getAgentDocuments).toHaveBeenCalledWith('agent-1');
      expect(result).toEqual([]);
    });

    it('prefixes the identifier with `agent-skills:` and pulls content from the SKILL.md index child', async () => {
      const service = new AgentDocumentsService(db, userId);
      vi.spyOn(service, 'getAgentDocuments').mockResolvedValue(
        stubDocs([
          {
            content: '',
            description: 'Triage workflow',
            documentId: 'bundle-1',
            filename: 'bug-triage',
            isSkillBundle: true,
            title: 'Bug Triage',
          },
          {
            content: '# Bug triage\n\nbody',
            documentId: 'index-1',
            filename: 'SKILL.md',
            isSkillIndex: true,
            parentId: 'bundle-1',
          },
          // Sibling non-index child — must be ignored.
          {
            content: 'reference',
            documentId: 'asset-1',
            filename: 'reference.md',
            parentId: 'bundle-1',
          },
        ]),
      );

      const result = await service.getAgentSkills('agent-1');

      expect(result).toEqual([
        {
          content: '# Bug triage\n\nbody',
          description: 'Triage workflow',
          filename: 'bug-triage',
          identifier: 'agent-skills:bug-triage',
          name: 'agent-skills:bug-triage',
          title: 'Bug Triage',
        },
      ]);
    });

    it('falls back to the bundle row content when the index child is missing', async () => {
      const service = new AgentDocumentsService(db, userId);
      vi.spyOn(service, 'getAgentDocuments').mockResolvedValue(
        stubDocs([
          {
            content: 'orphan body',
            description: null,
            documentId: 'orphan-1',
            filename: 'orphan-skill',
            isSkillBundle: true,
            title: 'Orphan',
          },
        ]),
      );

      const result = await service.getAgentSkills('agent-1');

      expect(result).toEqual([
        {
          content: 'orphan body',
          description: '',
          filename: 'orphan-skill',
          identifier: 'agent-skills:orphan-skill',
          name: 'agent-skills:orphan-skill',
          title: 'Orphan',
        },
      ]);
    });

    it('emits empty content for a bundle with no index child and no body', async () => {
      const service = new AgentDocumentsService(db, userId);
      vi.spyOn(service, 'getAgentDocuments').mockResolvedValue(
        stubDocs([
          {
            content: '',
            documentId: 'empty-1',
            filename: 'empty',
            isSkillBundle: true,
            title: 'Empty',
          },
        ]),
      );

      const [skill] = await service.getAgentSkills('agent-1');

      expect(skill.content).toBe('');
      expect(skill.identifier).toBe('agent-skills:empty');
    });

    it('returns one entry per skill bundle and ignores non-bundle docs', async () => {
      const service = new AgentDocumentsService(db, userId);
      vi.spyOn(service, 'getAgentDocuments').mockResolvedValue(
        stubDocs([
          {
            documentId: 'b-1',
            filename: 'one',
            isSkillBundle: true,
            title: 'One',
          },
          {
            content: 'one body',
            documentId: 'b-1-idx',
            isSkillIndex: true,
            parentId: 'b-1',
          },
          {
            documentId: 'b-2',
            filename: 'two',
            isSkillBundle: true,
            title: 'Two',
          },
          {
            content: 'two body',
            documentId: 'b-2-idx',
            isSkillIndex: true,
            parentId: 'b-2',
          },
          // Unrelated regular doc.
          { documentId: 'note', filename: 'note.md' },
        ]),
      );

      const result = await service.getAgentSkills('agent-1');

      expect(result.map((s) => s.identifier)).toEqual(['agent-skills:one', 'agent-skills:two']);
      expect(result.map((s) => s.content)).toEqual(['one body', 'two body']);
    });

    it('matches index children strictly by parentId — does not leak across bundles', async () => {
      const service = new AgentDocumentsService(db, userId);
      vi.spyOn(service, 'getAgentDocuments').mockResolvedValue(
        stubDocs([
          { documentId: 'b-1', filename: 'first', isSkillBundle: true },
          { documentId: 'b-2', filename: 'second', isSkillBundle: true },
          // Only b-2 has an index child; b-1 must fall back to its own (empty)
          // content rather than borrow b-2's content.
          {
            content: 'second body',
            documentId: 'b-2-idx',
            isSkillIndex: true,
            parentId: 'b-2',
          },
        ]),
      );

      const result = await service.getAgentSkills('agent-1');

      expect(result).toHaveLength(2);
      expect(result.find((s) => s.filename === 'first')?.content).toBe('');
      expect(result.find((s) => s.filename === 'second')?.content).toBe('second body');
    });
  });
});
