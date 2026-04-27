// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderSkillsAgentDocument } from './ProviderSkillsAgentDocument';

vi.mock('@/server/services/agentDocuments/headlessEditor', () => ({
  createMarkdownEditorSnapshot: vi.fn(async (content: string) => ({
    content,
    editorData: { markdown: content },
  })),
  exportEditorDataSnapshot: vi.fn(async ({ fallbackContent }: { fallbackContent?: string }) => ({
    content: fallbackContent ?? '',
    editorData: { exported: true },
  })),
}));

const createAgentDocument = (overrides: Record<string, unknown> = {}) =>
  ({
    content: 'existing content',
    documentId: 'document-1',
    editorData: { root: { children: [] } },
    fileType: 'custom/document',
    filename: 'skill-a',
    id: 'agent-doc-1',
    metadata: null,
    parentId: null,
    policy: null,
    policyLoad: 'progressive',
    templateId: null,
    title: 'skill-a',
    ...overrides,
  }) as any;

describe('Agent skill VFS providers', () => {
  const agentDocumentModel = {
    associate: vi.fn(),
    delete: vi.fn(),
    findByAgent: vi.fn(),
    update: vi.fn(),
  };
  const documentService = {
    createDocument: vi.fn(),
    deleteDocument: vi.fn(),
    trySaveCurrentDocumentHistory: vi.fn(),
    updateDocument: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ProviderSkillsAgentDocument agent namespace', () => {
    it('lists only tree-backed agent skill folders at the namespace root', async () => {
      agentDocumentModel.findByAgent.mockResolvedValue([
        createAgentDocument({
          documentId: 'root-1',
          fileType: 'custom/folder',
          filename: 'skills',
          id: 'agent-doc-root',
          metadata: { lobeSkill: { namespace: 'agent', role: 'namespace-root' } },
        }),
        createAgentDocument({
          documentId: 'folder-1',
          fileType: 'custom/folder',
          filename: 'agent-skill',
          id: 'agent-doc-folder',
          metadata: {
            lobeSkill: { namespace: 'agent', role: 'skill-folder', skillName: 'agent-skill' },
          },
          parentId: 'root-1',
        }),
        createAgentDocument({
          documentId: 'file-1',
          filename: 'SKILL.md',
          id: 'agent-doc-file',
          metadata: {
            lobeSkill: { namespace: 'agent', role: 'skill-file', skillName: 'agent-skill' },
          },
          parentId: 'folder-1',
        }),
        createAgentDocument({
          documentId: 'topic-folder',
          fileType: 'custom/folder',
          filename: 'topic-skill',
          id: 'agent-doc-topic-folder',
          metadata: {
            lobeSkill: {
              namespace: 'agent-topic',
              role: 'skill-folder',
              skillName: 'topic-skill',
              topicId: 'topic-1',
            },
          },
          parentId: 'root-topic',
        }),
      ]);

      const provider = new ProviderSkillsAgentDocument('agent', {
        agentDocumentModel,
        documentService,
      });

      const result = await provider.list({
        agentId: 'agent-1',
        path: './lobe/skills/agent/skills',
        resolvedPath: { namespace: 'agent', relativePath: '' },
      });

      expect(result).toEqual([
        expect.objectContaining({
          name: 'agent-skill',
          namespace: 'agent',
          path: './lobe/skills/agent/skills/agent-skill',
          type: 'directory',
        }),
      ]);
    });

    it('creates a tree-backed agent skill with namespace root, folder, and SKILL.md', async () => {
      agentDocumentModel.findByAgent.mockResolvedValue([]);
      documentService.createDocument
        .mockResolvedValueOnce({
          fileType: 'custom/folder',
          filename: 'skills',
          id: 'root-1',
          metadata: { lobeSkill: { namespace: 'agent', role: 'namespace-root' } },
          parentId: null,
          title: 'skills',
        })
        .mockResolvedValueOnce({
          fileType: 'custom/folder',
          filename: 'writer',
          id: 'folder-1',
          metadata: {
            lobeSkill: { namespace: 'agent', role: 'skill-folder', skillName: 'writer' },
          },
          parentId: 'root-1',
          title: 'writer',
        })
        .mockResolvedValueOnce({
          content: '# Skill',
          fileType: 'custom/document',
          filename: 'SKILL.md',
          id: 'file-1',
          metadata: { lobeSkill: { namespace: 'agent', role: 'skill-file', skillName: 'writer' } },
          parentId: 'folder-1',
          title: 'SKILL.md',
        });

      const provider = new ProviderSkillsAgentDocument('agent', {
        agentDocumentModel,
        documentService,
      });

      const result = await provider.create({
        agentId: 'agent-1',
        content: '# Skill',
        skillName: 'writer',
        targetNamespace: 'agent',
      });

      expect(documentService.createDocument).toHaveBeenNthCalledWith(1, {
        editorData: { root: { children: [], type: 'root' } },
        fileType: 'custom/folder',
        metadata: { lobeSkill: { namespace: 'agent', role: 'namespace-root' } },
        title: 'skills',
      });
      expect(documentService.createDocument).toHaveBeenNthCalledWith(2, {
        editorData: { root: { children: [], type: 'root' } },
        fileType: 'custom/folder',
        metadata: { lobeSkill: { namespace: 'agent', role: 'skill-folder', skillName: 'writer' } },
        parentId: 'root-1',
        title: 'writer',
      });
      expect(documentService.createDocument).toHaveBeenNthCalledWith(3, {
        content: '# Skill',
        editorData: { markdown: '# Skill' },
        metadata: { lobeSkill: { namespace: 'agent', role: 'skill-file', skillName: 'writer' } },
        parentId: 'folder-1',
        title: 'SKILL.md',
      });
      expect(agentDocumentModel.associate).toHaveBeenNthCalledWith(1, {
        agentId: 'agent-1',
        documentId: 'root-1',
        policyLoad: 'disabled',
        uniqueSibling: false,
      });
      expect(agentDocumentModel.associate).toHaveBeenNthCalledWith(2, {
        agentId: 'agent-1',
        documentId: 'folder-1',
        policyLoad: 'disabled',
        uniqueSibling: false,
      });
      expect(agentDocumentModel.associate).toHaveBeenNthCalledWith(3, {
        agentId: 'agent-1',
        documentId: 'file-1',
        uniqueSibling: false,
      });
      expect(result.path).toBe('./lobe/skills/agent/skills/writer/SKILL.md');
    });

    it('updates an agent skill through the document model and saves history when content changes', async () => {
      agentDocumentModel.findByAgent.mockResolvedValue([
        createAgentDocument({
          content: 'old content',
          documentId: 'file-1',
          filename: 'SKILL.md',
          id: 'agent-doc-file',
          metadata: { lobeSkill: { namespace: 'agent', role: 'skill-file', skillName: 'skill-a' } },
          parentId: 'folder-1',
        }),
      ]);

      const provider = new ProviderSkillsAgentDocument('agent', {
        agentDocumentModel,
        documentService,
      });

      const result = await provider.update({
        agentId: 'agent-1',
        content: 'new content',
        path: './lobe/skills/agent/skills/skill-a/SKILL.md',
      });

      expect(documentService.trySaveCurrentDocumentHistory).toHaveBeenCalledWith(
        'file-1',
        'llm_call',
      );
      expect(agentDocumentModel.update).toHaveBeenCalledWith('agent-doc-file', {
        content: 'new content',
        editorData: { markdown: 'new content' },
      });
      expect(result.content).toBe('new content');
    });

    it('soft-deletes the folder subtree for an agent skill', async () => {
      agentDocumentModel.findByAgent.mockResolvedValue([
        createAgentDocument({
          documentId: 'folder-1',
          fileType: 'custom/folder',
          filename: 'skill-a',
          id: 'agent-doc-folder',
          metadata: {
            lobeSkill: { namespace: 'agent', role: 'skill-folder', skillName: 'skill-a' },
          },
          parentId: 'root-1',
        }),
        createAgentDocument({
          documentId: 'file-1',
          filename: 'SKILL.md',
          id: 'agent-doc-file',
          metadata: { lobeSkill: { namespace: 'agent', role: 'skill-file', skillName: 'skill-a' } },
          parentId: 'folder-1',
        }),
      ]);

      const provider = new ProviderSkillsAgentDocument('agent', {
        agentDocumentModel,
        documentService,
      });

      await provider.delete({
        agentId: 'agent-1',
        path: './lobe/skills/agent/skills/skill-a/SKILL.md',
      });

      expect(documentService.deleteDocument).toHaveBeenCalledWith('folder-1');
    });
  });

  describe('ProviderSkillsAgentDocument agent-topic namespace', () => {
    it('lists only topic-matching tree-backed skills', async () => {
      agentDocumentModel.findByAgent.mockResolvedValue([
        createAgentDocument({
          documentId: 'topic-folder-1',
          fileType: 'custom/folder',
          filename: 'topic-skill-a',
          id: 'agent-doc-topic-a',
          metadata: {
            lobeSkill: {
              namespace: 'agent-topic',
              role: 'skill-folder',
              skillName: 'topic-skill-a',
              topicId: 'topic-1',
            },
          },
          parentId: 'root-topic-1',
        }),
        createAgentDocument({
          documentId: 'topic-folder-2',
          fileType: 'custom/folder',
          filename: 'topic-skill-b',
          id: 'agent-doc-topic-b',
          metadata: {
            lobeSkill: {
              namespace: 'agent-topic',
              role: 'skill-folder',
              skillName: 'topic-skill-b',
              topicId: 'topic-2',
            },
          },
          parentId: 'root-topic-2',
        }),
      ]);

      const provider = new ProviderSkillsAgentDocument('agent-topic', {
        agentDocumentModel,
        documentService,
      });

      const result = await provider.list({
        agentId: 'agent-1',
        path: './lobe/skills/agent-topic/skills',
        resolvedPath: { namespace: 'agent-topic', relativePath: '' },
        topicId: 'topic-1',
      });

      expect(result).toEqual([
        expect.objectContaining({
          name: 'topic-skill-a',
          namespace: 'agent-topic',
          path: './lobe/skills/agent-topic/skills/topic-skill-a',
        }),
      ]);
    });

    it('creates a topic skill with metadata scoped to the topic', async () => {
      agentDocumentModel.findByAgent.mockResolvedValue([]);
      documentService.createDocument
        .mockResolvedValueOnce({
          fileType: 'custom/folder',
          filename: 'skills',
          id: 'root-topic-1',
          metadata: {
            lobeSkill: { namespace: 'agent-topic', role: 'namespace-root', topicId: 'topic-1' },
          },
          parentId: null,
          title: 'skills',
        })
        .mockResolvedValueOnce({
          fileType: 'custom/folder',
          filename: 'topic-skill',
          id: 'topic-folder-1',
          metadata: {
            lobeSkill: {
              namespace: 'agent-topic',
              role: 'skill-folder',
              skillName: 'topic-skill',
              topicId: 'topic-1',
            },
          },
          parentId: 'root-topic-1',
          title: 'topic-skill',
        })
        .mockResolvedValueOnce({
          content: 'topic content',
          fileType: 'custom/document',
          filename: 'SKILL.md',
          id: 'topic-file-1',
          metadata: {
            lobeSkill: {
              namespace: 'agent-topic',
              role: 'skill-file',
              skillName: 'topic-skill',
              topicId: 'topic-1',
            },
          },
          parentId: 'topic-folder-1',
          title: 'SKILL.md',
        });

      const provider = new ProviderSkillsAgentDocument('agent-topic', {
        agentDocumentModel,
        documentService,
      });

      const result = await provider.create({
        agentId: 'agent-1',
        content: 'topic content',
        skillName: 'topic-skill',
        targetNamespace: 'agent-topic',
        topicId: 'topic-1',
      });

      expect(documentService.createDocument).toHaveBeenNthCalledWith(2, {
        editorData: { root: { children: [], type: 'root' } },
        fileType: 'custom/folder',
        metadata: {
          lobeSkill: {
            namespace: 'agent-topic',
            role: 'skill-folder',
            skillName: 'topic-skill',
            topicId: 'topic-1',
          },
        },
        parentId: 'root-topic-1',
        title: 'topic-skill',
      });
      expect(result.path).toBe('./lobe/skills/agent-topic/skills/topic-skill/SKILL.md');
    });

    it('soft-deletes the topic skill subtree without touching other topics', async () => {
      agentDocumentModel.findByAgent.mockResolvedValue([
        createAgentDocument({
          documentId: 'topic-folder-1',
          fileType: 'custom/folder',
          filename: 'topic-skill',
          id: 'agent-doc-topic-folder',
          metadata: {
            lobeSkill: {
              namespace: 'agent-topic',
              role: 'skill-folder',
              skillName: 'topic-skill',
              topicId: 'topic-1',
            },
          },
          parentId: 'root-topic-1',
        }),
        createAgentDocument({
          documentId: 'topic-file-1',
          filename: 'SKILL.md',
          id: 'agent-doc-topic-file',
          metadata: {
            lobeSkill: {
              namespace: 'agent-topic',
              role: 'skill-file',
              skillName: 'topic-skill',
              topicId: 'topic-1',
            },
          },
          parentId: 'topic-folder-1',
        }),
      ]);

      const provider = new ProviderSkillsAgentDocument('agent-topic', {
        agentDocumentModel,
        documentService,
      });

      await provider.delete({
        agentId: 'agent-1',
        path: './lobe/skills/agent-topic/skills/topic-skill/SKILL.md',
        topicId: 'topic-1',
      });

      expect(documentService.deleteDocument).toHaveBeenCalledWith('topic-folder-1');
    });

    it('promotes a topic skill by copying it into the agent namespace', async () => {
      agentDocumentModel.findByAgent.mockResolvedValue([
        createAgentDocument({
          content: 'topic content',
          documentId: 'topic-file-1',
          filename: 'SKILL.md',
          id: 'agent-doc-topic-file',
          metadata: {
            lobeSkill: {
              namespace: 'agent-topic',
              role: 'skill-file',
              skillName: 'topic-skill',
              topicId: 'topic-1',
            },
          },
          parentId: 'topic-folder-1',
        }),
      ]);
      documentService.createDocument
        .mockResolvedValueOnce({
          fileType: 'custom/folder',
          filename: 'skills',
          id: 'root-agent-1',
          metadata: { lobeSkill: { namespace: 'agent', role: 'namespace-root' } },
          parentId: null,
          title: 'skills',
        })
        .mockResolvedValueOnce({
          fileType: 'custom/folder',
          filename: 'promoted-skill',
          id: 'agent-folder-1',
          metadata: {
            lobeSkill: { namespace: 'agent', role: 'skill-folder', skillName: 'promoted-skill' },
          },
          parentId: 'root-agent-1',
          title: 'promoted-skill',
        })
        .mockResolvedValueOnce({
          content: 'topic content',
          fileType: 'custom/document',
          filename: 'SKILL.md',
          id: 'agent-file-1',
          metadata: {
            lobeSkill: { namespace: 'agent', role: 'skill-file', skillName: 'promoted-skill' },
          },
          parentId: 'agent-folder-1',
          title: 'SKILL.md',
        });

      const provider = new ProviderSkillsAgentDocument('agent-topic', {
        agentDocumentModel,
        documentService,
      });

      if (!provider.promote) {
        throw new Error('Expected agent-topic provider to support skill promotion');
      }

      const result = await provider.promote({
        agentId: 'agent-1',
        path: './lobe/skills/agent-topic/skills/topic-skill/SKILL.md',
        targetName: 'promoted-skill',
        topicId: 'topic-1',
      });

      expect(documentService.createDocument).toHaveBeenNthCalledWith(2, {
        editorData: { root: { children: [], type: 'root' } },
        fileType: 'custom/folder',
        metadata: {
          lobeSkill: {
            lineage: {
              sourceDocumentId: 'topic-file-1',
              sourceNamespace: 'agent-topic',
              sourceSkillName: 'topic-skill',
              sourceTopicId: 'topic-1',
            },
            namespace: 'agent',
            role: 'skill-folder',
            skillName: 'promoted-skill',
          },
        },
        parentId: 'root-agent-1',
        title: 'promoted-skill',
      });
      expect(result.namespace).toBe('agent');
      expect(result.path).toBe('./lobe/skills/agent/skills/promoted-skill/SKILL.md');
    });
  });
});
