// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentAccess, AgentDocumentModel } from '@/database/models/agentDocuments';
import type { LobeChatDatabase } from '@/database/type';

import { AgentDocumentVfsService } from './index';
import { createSkillMount } from './mounts/skills/createSkillMount';

vi.mock('@/database/models/agentDocuments', () => ({
  AgentAccess: {
    DELETE: 16,
    EXECUTE: 1,
    LIST: 8,
    READ: 2,
    WRITE: 4,
  },
  AgentDocumentModel: vi.fn(),
}));

vi.mock('./mounts/skills/createSkillMount', () => ({
  createSkillMount: vi.fn(),
}));

describe('AgentDocumentVfsService', () => {
  const db = {} as LobeChatDatabase;
  const userId = 'user-1';
  const mockAgentDocumentModel = {
    create: vi.fn(),
    findByDocumentId: vi.fn(),
    findByIdWithOptions: vi.fn(),
    findByParentAndFilename: vi.fn(),
    listByParentAndFilename: vi.fn(),
    listByParent: vi.fn(),
    listDeletedByAgent: vi.fn(),
    movePath: vi.fn(),
    permanentlyDelete: vi.fn(),
    restore: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  };
  const mockSkillMount = {
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
  };

  beforeEach(() => {
    for (const method of Object.values(mockAgentDocumentModel)) {
      method.mockReset();
    }
    for (const method of Object.values(mockSkillMount)) {
      method.mockReset();
    }
    (AgentDocumentModel as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => mockAgentDocumentModel,
    );
    (createSkillMount as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockSkillMount);
    mockAgentDocumentModel.listByParentAndFilename.mockImplementation(async (...args) => {
      const result = await mockAgentDocumentModel.findByParentAndFilename(...args);
      return result ? [result] : [];
    });
  });

  it('lists ordinary root nodes plus the synthetic lobe directory', async () => {
    mockAgentDocumentModel.listByParent.mockResolvedValue([
      {
        accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
        content: 'hello',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        documentId: 'documents-1',
        fileType: 'agent/document',
        filename: 'SOUL.md',
        id: 'agent-doc-1',
        updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      },
      {
        accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
        content: 'newer duplicate',
        createdAt: new Date('2024-01-02T00:00:00.000Z'),
        documentId: 'documents-duplicate',
        fileType: 'agent/document',
        filename: 'SOUL.md',
        id: 'agent-doc-duplicate',
        updatedAt: new Date('2024-01-03T00:00:00.000Z'),
      },
    ]);

    const service = new AgentDocumentVfsService(db, userId);
    const nodes = await service.list('./', { agentId: 'agent-1' });

    expect(mockAgentDocumentModel.listByParent).toHaveBeenCalledWith('agent-1', null, {
      cursor: undefined,
    });
    expect(nodes).toEqual([
      expect.objectContaining({
        agentDocumentId: 'agent-doc-1',
        documentId: 'documents-1',
        mode: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
        name: 'SOUL.md',
        path: './SOUL.md',
        type: 'file',
      }),
      expect.objectContaining({
        id: 'synthetic:./lobe',
        name: 'lobe',
        path: './lobe',
        type: 'directory',
      }),
    ]);
    expect(nodes).toHaveLength(2);
  });

  it('stats the unified VFS root as a synthetic directory', async () => {
    const service = new AgentDocumentVfsService(db, userId);
    const node = await service.stat('./', { agentId: 'agent-1' });

    expect(node).toEqual(
      expect.objectContaining({
        id: 'synthetic:./',
        path: './',
        type: 'directory',
      }),
    );
  });

  it('routes mounted skill listings through unified skill paths', async () => {
    mockSkillMount.list.mockResolvedValue([
      {
        name: 'writer',
        namespace: 'builtin',
        path: './lobe/skills/builtin/skills/writer',
        readOnly: true,
        type: 'directory',
      },
    ]);

    const service = new AgentDocumentVfsService(db, userId);
    const nodes = await service.list('./lobe/skills/builtin/skills', { agentId: 'agent-1' });

    expect(mockSkillMount.list).toHaveBeenCalledWith({
      agentId: 'agent-1',
      path: './lobe/skills/builtin/skills',
      topicId: undefined,
    });
    expect(nodes).toEqual([
      expect.objectContaining({
        mount: expect.objectContaining({
          driver: 'skills',
          namespace: 'builtin',
          source: 'builtin',
        }),
        name: 'writer',
        path: './lobe/skills/builtin/skills/writer',
        type: 'directory',
      }),
    ]);
  });

  it('resolves ordinary file stats through parentId + filename segments', async () => {
    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue({
      accessSelf: AgentAccess.READ | AgentAccess.LIST,
      content: '# Soul',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      documentId: 'documents-1',
      fileType: 'agent/document',
      filename: 'SOUL.md',
      id: 'agent-doc-1',
      metadata: { category: 'system' },
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    });

    const service = new AgentDocumentVfsService(db, userId);
    const node = await service.stat('./SOUL.md', { agentId: 'agent-1' });

    expect(mockAgentDocumentModel.listByParentAndFilename).toHaveBeenCalledWith(
      'agent-1',
      null,
      'SOUL.md',
      {},
    );
    expect(node).toEqual(
      expect.objectContaining({
        documentId: 'documents-1',
        metadata: { category: 'system' },
        path: './SOUL.md',
        type: 'file',
      }),
    );
  });

  it('creates a new ordinary file through write when the path is missing', async () => {
    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(undefined);
    mockAgentDocumentModel.listByParentAndFilename.mockResolvedValue([]);
    mockAgentDocumentModel.create.mockResolvedValue({
      accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
      content: 'hello',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      documentId: 'documents-2',
      fileType: 'agent/document',
      filename: 'notes.md',
      id: 'agent-doc-2',
      metadata: null,
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    });

    const service = new AgentDocumentVfsService(db, userId);
    const node = await service.write('./notes.md', 'hello', { agentId: 'agent-1' });

    expect(mockAgentDocumentModel.create).toHaveBeenCalledWith(
      'agent-1',
      'notes.md',
      expect.any(String),
      expect.objectContaining({
        editorData: expect.any(Object),
        parentId: null,
        title: 'notes.md',
      }),
    );
    expect(node).toEqual(
      expect.objectContaining({
        documentId: 'documents-2',
        path: './notes.md',
        type: 'file',
      }),
    );
  });

  it('resolves duplicate ordinary path segments to the oldest sibling', async () => {
    mockAgentDocumentModel.listByParentAndFilename.mockResolvedValue([
      {
        accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
        content: 'first',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        documentId: 'documents-first',
        fileType: 'agent/document',
        filename: 'notes.md',
        id: 'agent-doc-first',
      },
      {
        accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
        content: 'second',
        createdAt: new Date('2024-01-02T00:00:00.000Z'),
        documentId: 'documents-second',
        fileType: 'agent/document',
        filename: 'notes.md',
        id: 'agent-doc-second',
      },
    ]);

    const service = new AgentDocumentVfsService(db, userId);
    const stats = await service.stat('./notes.md', { agentId: 'agent-1' });

    if (!stats) throw new Error('Expected ./notes.md stats to resolve');

    expect(stats.documentId).toBe('documents-first');
    expect(mockAgentDocumentModel.create).not.toHaveBeenCalled();
  });

  it('updates an existing mounted skill through write', async () => {
    mockSkillMount.get.mockResolvedValue({
      content: '# Draft',
      name: 'SKILL.md',
      namespace: 'agent',
      path: './lobe/skills/agent/skills/writer/SKILL.md',
      readOnly: false,
      type: 'file',
    });
    mockSkillMount.update.mockResolvedValue({
      content: '# Final',
      name: 'SKILL.md',
      namespace: 'agent',
      path: './lobe/skills/agent/skills/writer/SKILL.md',
      readOnly: false,
      type: 'file',
    });

    const service = new AgentDocumentVfsService(db, userId);
    const node = await service.write('./lobe/skills/agent/skills/writer/SKILL.md', '# Final', {
      agentId: 'agent-1',
    });

    expect(mockSkillMount.update).toHaveBeenCalledWith({
      agentId: 'agent-1',
      content: '# Final',
      path: './lobe/skills/agent/skills/writer/SKILL.md',
      topicId: undefined,
    });
    expect(node).toEqual(
      expect.objectContaining({
        mount: expect.objectContaining({ driver: 'skills', namespace: 'agent' }),
        size: '# Final'.length,
      }),
    );
  });

  it('creates nested directories through mkdir when recursive is enabled', async () => {
    mockAgentDocumentModel.findByParentAndFilename
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    mockAgentDocumentModel.listByParentAndFilename.mockResolvedValue([]);
    mockAgentDocumentModel.create
      .mockResolvedValueOnce({
        accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
        content: '',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        documentId: 'folder-doc-1',
        fileType: 'custom/folder',
        filename: 'notes',
        id: 'folder-agent-doc-1',
        updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
        content: '',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        documentId: 'folder-doc-2',
        fileType: 'custom/folder',
        filename: 'archive',
        id: 'folder-agent-doc-2',
        updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      });

    const service = new AgentDocumentVfsService(db, userId);
    const node = await service.mkdir(
      './notes/archive',
      { agentId: 'agent-1' },
      { recursive: true },
    );

    expect(mockAgentDocumentModel.create).toHaveBeenNthCalledWith(
      1,
      'agent-1',
      'notes',
      '',
      expect.objectContaining({
        fileType: 'custom/folder',
        parentId: null,
      }),
    );
    expect(mockAgentDocumentModel.create).toHaveBeenNthCalledWith(
      2,
      'agent-1',
      'archive',
      '',
      expect.objectContaining({
        fileType: 'custom/folder',
        parentId: 'folder-doc-1',
      }),
    );
    expect(node).toEqual(
      expect.objectContaining({
        path: './notes/archive',
        type: 'directory',
      }),
    );
  });

  it('soft-deletes an ordinary subtree through delete', async () => {
    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue({
      accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
      content: '',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      documentId: 'folder-doc-1',
      fileType: 'custom/folder',
      filename: 'notes',
      id: 'folder-agent-doc-1',
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    });
    mockAgentDocumentModel.listByParent
      .mockResolvedValueOnce([
        {
          accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
          content: 'hello',
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          documentId: 'child-doc-1',
          fileType: 'agent/document',
          filename: 'todo.md',
          id: 'child-agent-doc-1',
          updatedAt: new Date('2024-01-02T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([]);

    const service = new AgentDocumentVfsService(db, userId);
    await service.delete('./notes', { agentId: 'agent-1' }, { recursive: true });

    expect(mockAgentDocumentModel.delete).toHaveBeenCalledWith(
      'folder-agent-doc-1',
      'recursive-delete',
    );
    expect(mockAgentDocumentModel.delete).toHaveBeenCalledWith('child-agent-doc-1', 'user-delete');
  });

  it('rejects copying a directory into its own subtree', async () => {
    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue({
      accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
      content: '',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      documentId: 'folder-doc-1',
      fileType: 'custom/folder',
      filename: 'notes',
      id: 'folder-agent-doc-1',
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    });

    const service = new AgentDocumentVfsService(db, userId);

    await expect(
      service.copy('./notes', './notes/archive', { agentId: 'agent-1' }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(mockAgentDocumentModel.create).not.toHaveBeenCalled();
  });

  it('rejects renaming a directory into its own subtree', async () => {
    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue({
      accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
      content: '',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      documentId: 'folder-doc-1',
      fileType: 'custom/folder',
      filename: 'notes',
      id: 'folder-agent-doc-1',
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    });

    const service = new AgentDocumentVfsService(db, userId);

    await expect(
      service.rename('./notes', './notes/archive', { agentId: 'agent-1' }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(mockAgentDocumentModel.create).not.toHaveBeenCalled();
  });

  it('renames ordinary files by moving the original document path in place', async () => {
    const sourceFile = {
      accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
      content: 'hello',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      documentId: 'documents-1',
      fileType: 'agent/document',
      filename: 'old.md',
      id: 'agent-doc-1',
      parentId: null,
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    };
    const movedFile = {
      ...sourceFile,
      filename: 'new.md',
      parentId: 'folder-doc-1',
    };

    mockAgentDocumentModel.listByParentAndFilename.mockImplementation(
      async (_agentId, parentId, filename) => {
        if (parentId === null && filename === 'old.md') return [sourceFile];
        if (parentId === null && filename === 'folder') {
          return [
            {
              accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
              content: '',
              documentId: 'folder-doc-1',
              fileType: 'custom/folder',
              filename: 'folder',
              id: 'folder-agent-doc-1',
              parentId: null,
            },
          ];
        }
        return [];
      },
    );
    mockAgentDocumentModel.movePath.mockResolvedValue(movedFile);

    const service = new AgentDocumentVfsService(db, userId);
    const node = await service.rename('./old.md', './folder/new.md', { agentId: 'agent-1' });

    expect(mockAgentDocumentModel.movePath).toHaveBeenCalledWith('agent-doc-1', {
      filename: 'new.md',
      parentId: 'folder-doc-1',
    });
    expect(mockAgentDocumentModel.create).not.toHaveBeenCalled();
    expect(mockAgentDocumentModel.delete).not.toHaveBeenCalled();
    expect(node).toEqual(
      expect.objectContaining({
        agentDocumentId: 'agent-doc-1',
        documentId: 'documents-1',
        path: './folder/new.md',
      }),
    );
  });

  it('rejects recursive directory copy when direct children exceed the safety cap', async () => {
    const sourceFolder = {
      accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
      content: '',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      documentId: 'folder-doc-1',
      fileType: 'custom/folder',
      filename: 'notes',
      id: 'folder-agent-doc-1',
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    };
    mockAgentDocumentModel.listByParentAndFilename.mockImplementation(
      async (_agentId, _parentId, filename) => (filename === 'notes' ? [sourceFolder] : []),
    );
    mockAgentDocumentModel.create.mockResolvedValue({
      ...sourceFolder,
      documentId: 'archive-doc-1',
      filename: 'archive',
      id: 'archive-agent-doc-1',
    });
    mockAgentDocumentModel.listByParent.mockResolvedValue(
      Array.from({ length: 5001 }, (_, index) => ({
        accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
        content: `file ${index}`,
        documentId: `doc-${index}`,
        fileType: 'agent/document',
        filename: `file-${index}.md`,
        id: `agent-doc-${index}`,
      })),
    );

    const service = new AgentDocumentVfsService(db, userId);

    await expect(
      service.copy('./notes', './archive', { agentId: 'agent-1' }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(mockAgentDocumentModel.listByParent).toHaveBeenCalledWith('agent-1', 'folder-doc-1', {
      limit: 5001,
    });
  });

  it('restores trash entries when a live sibling already owns the same filename', async () => {
    mockAgentDocumentModel.findByIdWithOptions.mockResolvedValue({
      accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
      content: 'deleted',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      deletedAt: new Date('2024-01-03T00:00:00.000Z'),
      documentId: 'deleted-doc-1',
      fileType: 'agent/document',
      filename: 'draft.md',
      id: 'deleted-agent-doc-1',
      parentId: null,
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    });
    mockAgentDocumentModel.listByParent.mockResolvedValue([]);
    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue({
      accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
      content: 'live',
      createdAt: new Date('2024-01-04T00:00:00.000Z'),
      documentId: 'live-doc-1',
      fileType: 'agent/document',
      filename: 'draft.md',
      id: 'live-agent-doc-1',
      parentId: null,
      updatedAt: new Date('2024-01-04T00:00:00.000Z'),
    });
    mockAgentDocumentModel.listByParentAndFilename.mockResolvedValue([
      {
        accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
        content: 'deleted',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        documentId: 'deleted-doc-1',
        fileType: 'agent/document',
        filename: 'draft.md',
        id: 'deleted-agent-doc-1',
        parentId: null,
        updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      },
      {
        accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
        content: 'live',
        createdAt: new Date('2024-01-04T00:00:00.000Z'),
        documentId: 'live-doc-1',
        fileType: 'agent/document',
        filename: 'draft.md',
        id: 'live-agent-doc-1',
        parentId: null,
        updatedAt: new Date('2024-01-04T00:00:00.000Z'),
      },
    ]);

    const service = new AgentDocumentVfsService(db, userId);

    const stats = await service.restoreFromTrash('deleted-agent-doc-1', { agentId: 'agent-1' });

    expect(stats.documentId).toBe('deleted-doc-1');
    expect(mockAgentDocumentModel.restore).toHaveBeenCalledWith('deleted-agent-doc-1');
  });

  it('permanently deletes ordinary directory subtrees child-first', async () => {
    mockAgentDocumentModel.findByIdWithOptions.mockResolvedValue({
      accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
      content: '',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      deletedAt: new Date('2024-01-03T00:00:00.000Z'),
      documentId: 'folder-doc-1',
      fileType: 'custom/folder',
      filename: 'notes',
      id: 'folder-agent-doc-1',
      parentId: null,
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    });
    mockAgentDocumentModel.listByParent
      .mockResolvedValueOnce([
        {
          accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
          content: 'hello',
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          deletedAt: new Date('2024-01-03T00:00:00.000Z'),
          documentId: 'child-doc-1',
          fileType: 'agent/document',
          filename: 'todo.md',
          id: 'child-agent-doc-1',
          parentId: 'folder-doc-1',
          updatedAt: new Date('2024-01-02T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([]);

    const service = new AgentDocumentVfsService(db, userId);
    await service.deletePermanently('folder-agent-doc-1', { agentId: 'agent-1' });

    expect(mockAgentDocumentModel.permanentlyDelete).toHaveBeenNthCalledWith(
      1,
      'child-agent-doc-1',
    );
    expect(mockAgentDocumentModel.permanentlyDelete).toHaveBeenNthCalledWith(
      2,
      'folder-agent-doc-1',
    );
  });

  it('opts read-only mounted skill paths out of trash deletes', async () => {
    const service = new AgentDocumentVfsService(db, userId);

    await expect(
      service.delete('./lobe/skills/builtin/skills/lobehub/SKILL.md', { agentId: 'agent-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('resolves deep ordinary paths one segment at a time without directory traversal', async () => {
    mockAgentDocumentModel.findByParentAndFilename
      .mockResolvedValueOnce({
        accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
        content: '',
        documentId: 'folder-a',
        fileType: 'custom/folder',
        filename: 'a',
        id: 'agent-doc-a',
      })
      .mockResolvedValueOnce({
        accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
        content: '',
        documentId: 'folder-b',
        fileType: 'custom/folder',
        filename: 'b',
        id: 'agent-doc-b',
      })
      .mockResolvedValueOnce({
        accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
        content: '# Leaf',
        documentId: 'file-c',
        fileType: 'agent/document',
        filename: 'c.md',
        id: 'agent-doc-c',
      });

    const service = new AgentDocumentVfsService(db, userId);
    const node = await service.stat('./a/b/c.md', { agentId: 'agent-1' });

    expect(node).toEqual(expect.objectContaining({ path: './a/b/c.md', type: 'file' }));
    expect(mockAgentDocumentModel.listByParentAndFilename).toHaveBeenCalledTimes(3);
    expect(mockAgentDocumentModel.listByParent).not.toHaveBeenCalled();
  });

  it('lists wide directories with one direct-child query and no subtree walk', async () => {
    mockAgentDocumentModel.listByParent.mockResolvedValue(
      Array.from({ length: 1000 }, (_, index) => ({
        accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
        content: `file ${index}`,
        documentId: `doc-${index}`,
        fileType: 'agent/document',
        filename: `file-${index}.md`,
        id: `agent-doc-${index}`,
      })),
    );

    const service = new AgentDocumentVfsService(db, userId);
    const nodes = await service.list('./', { agentId: 'agent-1' });

    expect(nodes).toHaveLength(101);
    expect(mockAgentDocumentModel.listByParent).toHaveBeenCalledTimes(1);
    expect(mockAgentDocumentModel.listByParent).toHaveBeenCalledWith('agent-1', null, {
      cursor: undefined,
    });
    expect(mockAgentDocumentModel.findByParentAndFilename).not.toHaveBeenCalled();
  });

  it('lists trash entries with reconstructed VFS paths', async () => {
    mockAgentDocumentModel.listDeletedByAgent.mockResolvedValue([
      {
        accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
        content: 'hello',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        deleteReason: 'user-delete',
        deletedAt: new Date('2024-01-03T00:00:00.000Z'),
        documentId: 'child-doc-1',
        fileType: 'agent/document',
        filename: 'todo.md',
        id: 'child-agent-doc-1',
        parentId: 'folder-doc-1',
        updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      },
    ]);
    mockAgentDocumentModel.findByDocumentId.mockResolvedValue({
      accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
      content: '',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      deleteReason: 'recursive-delete',
      deletedAt: new Date('2024-01-03T00:00:00.000Z'),
      documentId: 'folder-doc-1',
      fileType: 'custom/folder',
      filename: 'notes',
      id: 'folder-agent-doc-1',
      parentId: null,
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    });

    const service = new AgentDocumentVfsService(db, userId);
    const entries = await service.listTrash({ agentId: 'agent-1' });

    expect(entries).toEqual([
      expect.objectContaining({
        deleteReason: 'user-delete',
        deletedAt: new Date('2024-01-03T00:00:00.000Z'),
        path: './notes/todo.md',
      }),
    ]);
  });
});
