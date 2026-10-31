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
      fileType: AGENT_DOCUMENT_FILE_TYPE,
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
        fileType: AGENT_DOCUMENT_FILE_TYPE,
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

  it('copies an ordinary directory recursively through mkdir and write', async () => {
    const docs: any[] = [folderDoc('notes', 'notes-doc'), fileDoc('a.md', 'a-doc', 'notes-doc')];
    mockAgentDocumentModel.listByParentAndFilename.mockImplementation(
      async (_agentId, parentId, filename) =>
        docs.filter((doc) => doc.parentId === parentId && doc.filename === filename),
    );
    mockAgentDocumentModel.findByParentAndFilename.mockImplementation(
      async (_agentId, parentId, filename) =>
        docs.find((doc) => doc.parentId === parentId && doc.filename === filename),
    );
    mockAgentDocumentModel.listByParent.mockImplementation(async (_agentId, parentId) =>
      docs.filter((doc) => doc.parentId === parentId),
    );
    mockAgentDocumentModel.create.mockImplementation(
      async (_agentId, filename, content, options) => {
        const doc = {
          ...(options.fileType === 'custom/folder'
            ? folderDoc(filename, `${filename}-copy`, options.parentId)
            : fileDoc(filename, `${filename}-copy`, options.parentId, content)),
        };
        docs.push(doc);
        return doc;
      },
    );

    const service = new AgentDocumentVfsService(db, userId);
    const node = await service.copy('./notes', './archive', { agentId: 'agent-1' });

    expect(
      mockAgentDocumentModel.create.mock.calls.map((call) => [call[1], call[3].parentId]),
    ).toEqual([
      ['archive', null],
      ['a.md', 'archive-copy'],
    ]);
    expect(mockAgentDocumentModel.create.mock.calls[1][2]).toContain('hello');
    expect(mockAgentDocumentModel.listByParent).toHaveBeenCalledWith('agent-1', 'notes-doc', {
      limit: 5001,
    });
    expect(node).toEqual(expect.objectContaining({ path: './archive', type: 'directory' }));
  });

  it('rejects copying onto an existing path unless overwrite is set', async () => {
    mockAgentDocumentModel.listByParentAndFilename.mockImplementation(
      async (_agentId, parentId, filename) =>
        parentId === null && (filename === 'a.md' || filename === 'b.md')
          ? [fileDoc(filename, `${filename}-doc`)]
          : [],
    );
    mockAgentDocumentModel.update.mockResolvedValue(undefined);

    const service = new AgentDocumentVfsService(db, userId);

    await expect(service.copy('./a.md', './b.md', { agentId: 'agent-1' })).rejects.toThrow(
      'Path already exists: ./b.md',
    );

    const node = await service.copy(
      './a.md',
      './b.md',
      { agentId: 'agent-1' },
      { overwrite: true },
    );

    expect(mockAgentDocumentModel.update).toHaveBeenCalledWith(
      'agent-b.md-doc',
      expect.objectContaining({ content: expect.stringContaining('hello') }),
    );
    expect(node).toEqual(expect.objectContaining({ path: './b.md' }));
  });

  it('moves a mounted skill into the ordinary tree by copying then deleting the source', async () => {
    mockSkillMount.get.mockResolvedValue({
      content: '# Writer',
      name: 'SKILL.md',
      namespace: 'agent',
      path: './lobe/skills/agent/skills/writer/SKILL.md',
      type: 'file',
    });
    mockAgentDocumentModel.listByParentAndFilename.mockResolvedValue([]);
    mockAgentDocumentModel.create.mockResolvedValue(fileDoc('writer.md', 'writer-doc'));

    const service = new AgentDocumentVfsService(db, userId);
    const node = await service.rename('./lobe/skills/agent/skills/writer', './writer.md', {
      agentId: 'agent-1',
    });

    expect(mockSkillMount.get).toHaveBeenCalledWith({
      agentId: 'agent-1',
      path: './lobe/skills/agent/skills/writer/SKILL.md',
      topicId: undefined,
    });
    expect(mockAgentDocumentModel.create).toHaveBeenCalledWith(
      'agent-1',
      'writer.md',
      expect.stringContaining('Writer'),
      expect.objectContaining({ parentId: null }),
    );
    expect(mockSkillMount.delete).toHaveBeenCalledWith({
      agentId: 'agent-1',
      path: './lobe/skills/agent/skills/writer/SKILL.md',
      topicId: undefined,
    });
    expect(node).toEqual(expect.objectContaining({ path: './writer.md' }));
  });

  it('returns the existing node when renaming a path onto itself', async () => {
    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(fileDoc('a.md', 'doc-1'));

    const service = new AgentDocumentVfsService(db, userId);
    const node = await service.rename('./a.md', '/a.md', { agentId: 'agent-1' });

    expect(node).toEqual(expect.objectContaining({ path: './a.md' }));
    expect(mockAgentDocumentModel.movePath).not.toHaveBeenCalled();

    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(undefined);
    await expect(service.rename('./b.md', './b.md', { agentId: 'agent-1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('guards ordinary renames against reserved, existing and directory destinations', async () => {
    mockAgentDocumentModel.listByParentAndFilename.mockImplementation(
      async (_agentId, parentId, filename) => {
        if (parentId !== null) return [];
        if (filename === 'a.md') return [fileDoc('a.md', 'a-doc')];
        if (filename === 'b.md') return [fileDoc('b.md', 'b-doc')];
        if (filename === 'dir') return [folderDoc('dir', 'dir-doc')];
        return [];
      },
    );
    mockAgentDocumentModel.listByParent.mockResolvedValue([]);
    mockAgentDocumentModel.movePath.mockResolvedValue(fileDoc('b.md', 'a-doc'));

    const service = new AgentDocumentVfsService(db, userId);
    const ctx = { agentId: 'agent-1' };

    await expect(service.rename('./a.md', './lobe/a.md', ctx)).rejects.toThrow(
      'Cannot rename to reserved path: ./lobe/a.md',
    );
    await expect(service.rename('./a.md', './b.md', ctx)).rejects.toThrow(
      'Path already exists: ./b.md',
    );
    await expect(service.rename('./a.md', './dir', ctx, { overwrite: true })).rejects.toThrow(
      'Cannot overwrite directory path: ./dir',
    );
    await expect(service.rename('./a.md', './missing/a.md', ctx)).rejects.toThrow(
      'Parent path not found: ./missing',
    );

    const node = await service.rename('./a.md', './b.md', ctx, { overwrite: true });

    expect(mockAgentDocumentModel.delete).toHaveBeenCalledWith('agent-b-doc', 'user-delete');
    expect(mockAgentDocumentModel.movePath).toHaveBeenCalledWith('agent-a-doc', {
      filename: 'b.md',
      parentId: null,
    });
    expect(node).toEqual(expect.objectContaining({ path: './b.md' }));
  });
});
