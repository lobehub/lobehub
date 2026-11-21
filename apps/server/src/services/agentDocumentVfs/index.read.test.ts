// @vitest-environment node
import { AGENT_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentAccess } from '@/database/models/agentDocuments';

import { FileService } from '../file';
import { AgentDocumentVfsService } from './index';
import { db, mockAgentDocumentModel, mockSkillMount, resetVfsMocks, userId } from './testUtils';

vi.mock('@/database/models/agentDocuments', () => ({
  AgentAccess: {
    DELETE: 16,
    EXECUTE: 1,
    LIST: 8,
    READ: 2,
    WRITE: 4,
  },
  AgentDocumentModel: vi.fn(),
  buildDocumentFilename: vi.fn(function (title: string) {
    return title;
  }),
}));

vi.mock('./mounts/skills/createSkillMount', () => ({
  createSkillMount: vi.fn(),
}));

const removeUnreferencedFile = vi.hoisted(() => vi.fn());
vi.mock('../file', () => ({
  FileService: vi.fn(function () {
    return { removeUnreferencedFile };
  }),
}));

const folderDoc = (filename: string, documentId: string, parentId: string | null = null) => ({
  accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
  content: '',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  documentId,
  fileType: 'custom/folder',
  filename,
  id: `agent-${documentId}`,
  parentId,
  updatedAt: new Date('2024-01-02T00:00:00.000Z'),
});

const fileDoc = (
  filename: string,
  documentId: string,
  parentId: string | null = null,
  content = 'hello',
) => ({
  accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
  content,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  documentId,
  fileType: AGENT_DOCUMENT_FILE_TYPE,
  filename,
  id: `agent-${documentId}`,
  parentId,
  updatedAt: new Date('2024-01-02T00:00:00.000Z'),
});

describe('AgentDocumentVfsService', () => {
  beforeEach(() => {
    vi.mocked(FileService).mockClear();
    removeUnreferencedFile.mockReset().mockResolvedValue(undefined);
    resetVfsMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** @example Native VFS browsing remains available without object storage. */
  it('does not initialize storage when listing native documents', async () => {
    mockAgentDocumentModel.listByParent.mockResolvedValue([]);
    const service = new AgentDocumentVfsService(db, userId);
    await service.list('./', { agentId: 'agent-1' });
    /** @example Browsing a document tree has no storage configuration prerequisite. */
    expect(FileService).not.toHaveBeenCalled();
  });

  it('lists ordinary root nodes plus the synthetic lobe directory', async () => {
    mockAgentDocumentModel.listByParent.mockResolvedValue([
      {
        accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
        content: 'hello',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        documentId: 'documents-1',
        fileType: AGENT_DOCUMENT_FILE_TYPE,
        filename: 'SOUL.md',
        id: 'agent-doc-1',
        updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      },
      {
        accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
        content: 'newer duplicate',
        createdAt: new Date('2024-01-02T00:00:00.000Z'),
        documentId: 'documents-duplicate',
        fileType: AGENT_DOCUMENT_FILE_TYPE,
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
      fileType: AGENT_DOCUMENT_FILE_TYPE,
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

  it('reads an ordinary file line range with loc metadata', async () => {
    mockAgentDocumentModel.listByParentAndFilename.mockResolvedValue([
      {
        accessSelf: AgentAccess.READ | AgentAccess.LIST,
        content: ['line 0', 'line 1', 'line 2', 'line 3'].join('\n'),
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        documentId: 'documents-1',
        fileType: AGENT_DOCUMENT_FILE_TYPE,
        filename: 'SOUL.md',
        id: 'agent-doc-1',
        updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      },
    ]);

    const service = new AgentDocumentVfsService(db, userId);
    const result = await service.read('./SOUL.md', { agentId: 'agent-1' }, { loc: [1, 3] });

    expect(result).toEqual(
      expect.objectContaining({
        content: 'line 1\nline 2',
        lineCount: 2,
        loc: [1, 3],
        path: './SOUL.md',
        totalLineCount: 4,
      }),
    );
  });

  it('reads a mounted skill file line range with loc metadata', async () => {
    mockSkillMount.get.mockResolvedValue({
      content: ['# Skill', '', 'Use this skill.', 'Extra notes.'].join('\n'),
      contentType: 'text/markdown',
      name: 'SKILL.md',
      namespace: 'agent',
      path: './lobe/skills/agent/skills/writer/SKILL.md',
      readOnly: false,
      type: 'file',
    });

    const service = new AgentDocumentVfsService(db, userId);
    const result = await service.read(
      './lobe/skills/agent/skills/writer/SKILL.md',
      {
        agentId: 'agent-1',
      },
      { loc: [2, 4] },
    );

    expect(result).toEqual(
      expect.objectContaining({
        content: 'Use this skill.\nExtra notes.',
        contentType: 'text/markdown',
        lineCount: 2,
        loc: [2, 4],
        path: './lobe/skills/agent/skills/writer/SKILL.md',
        totalLineCount: 4,
      }),
    );
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
        fileType: AGENT_DOCUMENT_FILE_TYPE,
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
        fileType: AGENT_DOCUMENT_FILE_TYPE,
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

  it.each([
    [0, 1],
    [2.9, 2],
    [10_000, 500],
  ])('clamps a list limit of %s to %s ordinary entries', async (limit, expected) => {
    mockAgentDocumentModel.listByParent.mockResolvedValue(
      Array.from({ length: 1000 }, (_, index) =>
        fileDoc(`file-${String(index).padStart(4, '0')}.md`, `doc-${index}`),
      ),
    );

    const service = new AgentDocumentVfsService(db, userId);
    const nodes = await service.list('./', { agentId: 'agent-1' }, { limit });

    expect(nodes).toHaveLength(expected + 1);
    expect(nodes.at(-1)).toEqual(expect.objectContaining({ path: './lobe' }));
  });

  it.each(['./a/../b', './a/./b', './a/..'])('rejects the traversal path %s', async (path) => {
    const service = new AgentDocumentVfsService(db, userId);

    await expect(service.stat(path, { agentId: 'agent-1' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it.each([
    ['/notes.md', './notes.md'],
    ['notes.md', './notes.md'],
    ['.//notes.md/', './notes.md'],
  ])('normalizes %s to %s before resolving', async (input, expected) => {
    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(fileDoc('notes.md', 'doc-1'));

    const service = new AgentDocumentVfsService(db, userId);
    const node = await service.stat(input, { agentId: 'agent-1' });

    expect(node).toEqual(expect.objectContaining({ path: expected, type: 'file' }));
  });

  it('lists synthetic skill directories without touching storage', async () => {
    const service = new AgentDocumentVfsService(db, userId);
    const ctx = { agentId: 'agent-1' };

    expect((await service.list('./lobe', ctx)).map((node) => node.path)).toEqual(['./lobe/skills']);
    expect((await service.list('./lobe/skills', ctx)).map((node) => node.path)).toEqual([
      './lobe/skills/builtin',
      './lobe/skills/installed',
      './lobe/skills/agent',
    ]);
    expect((await service.list('./lobe/skills/installed', ctx)).map((node) => node.path)).toEqual([
      './lobe/skills/installed/all',
      './lobe/skills/installed/active',
    ]);
    expect(await service.list('./lobe/skills/installed/active', ctx)).toEqual([
      expect.objectContaining({
        mount: { driver: 'skills', namespace: 'installed-active', source: 'installed' },
        path: './lobe/skills/installed/active/skills',
        type: 'directory',
      }),
    ]);
    expect(await service.stat('./lobe/skills/builtin/skills', ctx)).toEqual(
      expect.objectContaining({
        mount: { driver: 'skills', namespace: 'builtin', source: 'builtin' },
        name: 'skills',
        type: 'directory',
      }),
    );
    expect(mockAgentDocumentModel.listByParent).not.toHaveBeenCalled();
    expect(mockSkillMount.list).not.toHaveBeenCalled();
  });

  it('rejects listing a missing path or an ordinary file', async () => {
    const service = new AgentDocumentVfsService(db, userId);

    await expect(service.list('./missing', { agentId: 'agent-1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(fileDoc('a.md', 'doc-1'));

    await expect(service.list('./a.md', { agentId: 'agent-1' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('rejects reading a missing path, a directory, or a mounted directory', async () => {
    const service = new AgentDocumentVfsService(db, userId);

    await expect(service.read('./missing.md', { agentId: 'agent-1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(folderDoc('notes', 'f-1'));
    await expect(service.read('./notes', { agentId: 'agent-1' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    mockSkillMount.get.mockResolvedValue({
      name: 'writer',
      namespace: 'agent',
      path: './lobe/skills/agent/skills/writer',
      type: 'directory',
    });
    await expect(
      service.read('./lobe/skills/agent/skills/writer', { agentId: 'agent-1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it.each([
    ['agent', 2 | 8 | 4 | 16, 'documents'],
    ['builtin', 2 | 8, 'builtin'],
    ['installed-all', 2 | 8, 'installed'],
  ])('maps mounted %s skill stats to mode %s from source %s', async (namespace, mode, source) => {
    mockSkillMount.get.mockResolvedValue({
      content: 'body',
      contentType: 'text/markdown',
      name: 'SKILL.md',
      namespace,
      path: `./lobe/skills/${namespace}/skills/x/SKILL.md`,
      type: 'file',
    });

    const service = new AgentDocumentVfsService(db, userId);
    const node = await service.stat(`./lobe/skills/${namespace}/skills/x/SKILL.md`, {
      agentId: 'agent-1',
      topicId: 'topic-1',
    });

    expect(mockSkillMount.get).toHaveBeenCalledWith({
      agentId: 'agent-1',
      path: `./lobe/skills/${namespace}/skills/x/SKILL.md`,
      topicId: 'topic-1',
    });
    expect(node).toEqual({
      contentType: 'text/markdown',
      id: `skills:${namespace}:./lobe/skills/${namespace}/skills/x/SKILL.md`,
      mode,
      mount: { driver: 'skills', namespace, source },
      name: 'SKILL.md',
      path: `./lobe/skills/${namespace}/skills/x/SKILL.md`,
      size: 4,
      type: 'file',
    });
  });
});
