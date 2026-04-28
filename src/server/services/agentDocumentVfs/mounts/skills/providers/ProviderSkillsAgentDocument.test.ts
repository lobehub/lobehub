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
    create: vi.fn(),
    delete: vi.fn(),
    deleteSubtreeByDocumentId: vi.fn(),
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
          templateId: 'agent-skill',
        }),
        createAgentDocument({
          documentId: 'folder-1',
          fileType: 'custom/folder',
          filename: 'agent-skill',
          id: 'agent-doc-folder',
          templateId: 'agent-skill',
          parentId: 'root-1',
        }),
        createAgentDocument({
          documentId: 'file-1',
          filename: 'SKILL.md',
          id: 'agent-doc-file',
          templateId: 'agent-skill',
          parentId: 'folder-1',
        }),
        createAgentDocument({
          documentId: 'plain-folder',
          fileType: 'custom/folder',
          filename: 'plain-folder',
          id: 'agent-doc-plain-folder',
          metadata: null,
          parentId: null,
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
      agentDocumentModel.create
        .mockResolvedValueOnce({
          documentId: 'root-1',
          fileType: 'custom/folder',
          filename: 'skills',
          id: 'agent-doc-root',
          metadata: null,
          parentId: null,
          templateId: 'agent-skill',
          title: 'skills',
        })
        .mockResolvedValueOnce({
          documentId: 'folder-1',
          fileType: 'custom/folder',
          filename: 'writer',
          id: 'agent-doc-folder',
          metadata: null,
          parentId: 'root-1',
          templateId: 'agent-skill',
          title: 'writer',
        })
        .mockResolvedValueOnce({
          content: '# Skill',
          documentId: 'file-1',
          fileType: 'skill/index',
          filename: 'SKILL.md',
          id: 'agent-doc-file',
          metadata: null,
          parentId: 'folder-1',
          templateId: 'agent-skill',
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

      expect(agentDocumentModel.create).toHaveBeenNthCalledWith(1, 'agent-1', 'skills', '', {
        editorData: { root: { children: [], type: 'root' } },
        fileType: 'custom/folder',
        policyLoad: 'disabled',
        templateId: 'agent-skill',
        title: 'skills',
      });
      expect(agentDocumentModel.create).toHaveBeenNthCalledWith(2, 'agent-1', 'writer', '', {
        editorData: { root: { children: [], type: 'root' } },
        fileType: 'custom/folder',
        parentId: 'root-1',
        policyLoad: 'disabled',
        templateId: 'agent-skill',
        title: 'writer',
      });
      expect(agentDocumentModel.create).toHaveBeenNthCalledWith(
        3,
        'agent-1',
        'SKILL.md',
        '# Skill',
        {
          editorData: { markdown: '# Skill' },
          fileType: 'skill/index',
          parentId: 'folder-1',
          templateId: 'agent-skill',
          title: 'SKILL.md',
        },
      );
      expect(documentService.createDocument).not.toHaveBeenCalled();
      expect(agentDocumentModel.associate).not.toHaveBeenCalled();
      expect(result.path).toBe('./lobe/skills/agent/skills/writer/SKILL.md');
    });

    /**
     * @example
     * A partially-created skill folder reserves the package name and blocks duplicate creation.
     */
    it('rejects creating a skill when the managed skill folder already exists without SKILL.md', async () => {
      const provider = new ProviderSkillsAgentDocument('agent', {
        agentDocumentModel,
        documentService,
      });
      agentDocumentModel.findByAgent.mockResolvedValue([
        {
          documentId: 'root-doc',
          fileType: 'custom/folder',
          filename: 'skills',
          id: 'root-binding',
          parentId: null,
          templateId: 'agent-skill',
        },
        {
          documentId: 'folder-doc',
          fileType: 'custom/folder',
          filename: 'writer',
          id: 'folder-binding',
          parentId: 'root-doc',
          templateId: 'agent-skill',
        },
      ] as never);

      await expect(
        provider.create({
          agentId: 'agent-1',
          content: '# Writer',
          skillName: 'writer',
          targetNamespace: 'agent',
        }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'Skill already exists',
      });

      expect(documentService.createDocument).not.toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'SKILL.md',
        }),
      );
    });

    it('updates an agent skill through the document model and saves history when content changes', async () => {
      agentDocumentModel.findByAgent.mockResolvedValue([
        createAgentDocument({
          documentId: 'root-1',
          fileType: 'custom/folder',
          filename: 'skills',
          id: 'agent-doc-root',
          parentId: null,
          templateId: 'agent-skill',
        }),
        createAgentDocument({
          documentId: 'folder-1',
          fileType: 'custom/folder',
          filename: 'skill-a',
          id: 'agent-doc-folder',
          parentId: 'root-1',
          templateId: 'agent-skill',
        }),
        createAgentDocument({
          content: 'old content',
          documentId: 'file-1',
          filename: 'SKILL.md',
          id: 'agent-doc-file',
          parentId: 'folder-1',
          templateId: 'agent-skill',
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
          documentId: 'root-1',
          fileType: 'custom/folder',
          filename: 'skills',
          id: 'agent-doc-root',
          parentId: null,
          templateId: 'agent-skill',
        }),
        createAgentDocument({
          documentId: 'folder-1',
          fileType: 'custom/folder',
          filename: 'skill-a',
          id: 'agent-doc-folder',
          parentId: 'root-1',
          templateId: 'agent-skill',
        }),
        createAgentDocument({
          documentId: 'file-1',
          filename: 'SKILL.md',
          id: 'agent-doc-file',
          parentId: 'folder-1',
          templateId: 'agent-skill',
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

      expect(agentDocumentModel.deleteSubtreeByDocumentId).toHaveBeenCalledWith(
        'agent-1',
        'folder-1',
        'skill-delete',
      );
      expect(documentService.deleteDocument).not.toHaveBeenCalled();
    });
  });
});
