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
        fileType: 'skill/index',
        metadata: { lobeSkill: { namespace: 'agent', role: 'skill-file', skillName: 'writer' } },
        parentId: 'folder-1',
        title: 'SKILL.md',
      });
      expect(agentDocumentModel.associate).toHaveBeenNthCalledWith(1, {
        agentId: 'agent-1',
        documentId: 'root-1',
        policyLoad: 'disabled',
      });
      expect(agentDocumentModel.associate).toHaveBeenNthCalledWith(2, {
        agentId: 'agent-1',
        documentId: 'folder-1',
        policyLoad: 'disabled',
      });
      expect(agentDocumentModel.associate).toHaveBeenNthCalledWith(3, {
        agentId: 'agent-1',
        documentId: 'file-1',
      });
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
          filename: 'skills',
          id: 'root-binding',
          metadata: {
            lobeSkill: {
              namespace: 'agent',
              role: 'namespace-root',
            },
          },
          parentId: null,
        },
        {
          documentId: 'folder-doc',
          filename: 'writer',
          id: 'folder-binding',
          metadata: {
            lobeSkill: {
              namespace: 'agent',
              role: 'skill-folder',
              skillName: 'writer',
            },
          },
          parentId: 'root-doc',
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
});
