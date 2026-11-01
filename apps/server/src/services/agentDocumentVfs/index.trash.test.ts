// @vitest-environment node
import { AGENT_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import { FileSource } from '@lobechat/types';
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
          fileType: AGENT_DOCUMENT_FILE_TYPE,
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

  it('restores trash entries when a live sibling already owns the same filename', async () => {
    mockAgentDocumentModel.findByIdWithOptions.mockResolvedValue({
      accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
      content: 'deleted',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      deletedAt: new Date('2024-01-03T00:00:00.000Z'),
      documentId: 'deleted-doc-1',
      fileType: AGENT_DOCUMENT_FILE_TYPE,
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
      fileType: AGENT_DOCUMENT_FILE_TYPE,
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
        fileType: AGENT_DOCUMENT_FILE_TYPE,
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
        fileType: AGENT_DOCUMENT_FILE_TYPE,
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
    // ROOT CAUSE:
    // Permanent deletion removed document rows without reclaiming hidden backing uploads.
    // Returned file IDs now go through reference-safe cleanup after each committed deletion.
    mockAgentDocumentModel.permanentlyDelete
      .mockResolvedValueOnce(['child-file'])
      .mockResolvedValueOnce([]);
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
          fileType: AGENT_DOCUMENT_FILE_TYPE,
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
    /** @example The child upload is reclaimed using the dedicated source policy. */
    expect(removeUnreferencedFile.mock.calls).toEqual([['child-file', FileSource.AgentDocument]]);
  });

  it('opts read-only mounted skill paths out of trash deletes', async () => {
    const service = new AgentDocumentVfsService(db, userId);

    await expect(
      service.delete('./lobe/skills/builtin/skills/lobehub/SKILL.md', { agentId: 'agent-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
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
        fileType: AGENT_DOCUMENT_FILE_TYPE,
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

  it('requires recursive=true to delete a directory', async () => {
    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(folderDoc('notes', 'f-1'));
    mockAgentDocumentModel.listByParent.mockResolvedValue([]);

    const service = new AgentDocumentVfsService(db, userId);

    await expect(service.delete('./notes', { agentId: 'agent-1' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(undefined);
    await expect(service.delete('./missing', { agentId: 'agent-1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(mockAgentDocumentModel.delete).not.toHaveBeenCalled();
  });

  it('deletes an agent skill through its SKILL.md path', async () => {
    const service = new AgentDocumentVfsService(db, userId);

    await service.delete('./lobe/skills/agent/skills/writer', {
      agentId: 'agent-1',
      topicId: 'topic-1',
    });

    expect(mockSkillMount.delete).toHaveBeenCalledWith({
      agentId: 'agent-1',
      path: './lobe/skills/agent/skills/writer/SKILL.md',
      topicId: 'topic-1',
    });
    await expect(
      service.delete('./lobe/skills/agent/skills', { agentId: 'agent-1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('filters trash entries by path prefix', async () => {
    mockAgentDocumentModel.listDeletedByAgent.mockResolvedValue([
      { ...fileDoc('todo.md', 'todo-doc'), deletedAt: new Date('2024-01-03T00:00:00.000Z') },
      { ...fileDoc('todo.md', 'nested-doc', 'notes-doc'), deletedAt: null },
    ]);
    mockAgentDocumentModel.findByDocumentId.mockResolvedValue(folderDoc('notes', 'notes-doc'));

    const service = new AgentDocumentVfsService(db, userId);
    const entries = await service.listTrash({ agentId: 'agent-1' }, '/notes');

    expect(entries).toEqual([
      expect.objectContaining({ deletedAt: new Date(0), path: './notes/todo.md' }),
    ]);
  });

  it('resolves trash entries by path for restore and permanent delete', async () => {
    const deleted = {
      ...fileDoc('draft.md', 'draft-doc'),
      deletedAt: new Date('2024-01-03T00:00:00.000Z'),
    };
    mockAgentDocumentModel.listDeletedByAgent.mockResolvedValue([deleted]);
    mockAgentDocumentModel.findByIdWithOptions.mockResolvedValue(deleted);
    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(deleted);

    const service = new AgentDocumentVfsService(db, userId);
    const ctx = { agentId: 'agent-1' };

    await expect(service.restoreFromTrashByPath('./other.md', ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(service.deletePermanentlyByPath('./other.md', ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const restored = await service.restoreFromTrashByPath('./draft.md', ctx);
    expect(mockAgentDocumentModel.findByIdWithOptions).toHaveBeenCalledWith('agent-draft-doc', {
      includeDeleted: true,
    });
    expect(mockAgentDocumentModel.restore).toHaveBeenCalledWith('agent-draft-doc');
    expect(restored).toEqual(expect.objectContaining({ path: './draft.md' }));

    await service.deletePermanentlyByPath('./draft.md', ctx);
    expect(mockAgentDocumentModel.permanentlyDelete).toHaveBeenCalledWith('agent-draft-doc');
  });

  it('restores deleted ancestors before the subtree and rejects live entries', async () => {
    const root = {
      ...fileDoc('todo.md', 'todo-doc', 'notes-doc'),
      deletedAt: new Date('2024-01-03T00:00:00.000Z'),
    };
    const parent = { ...folderDoc('notes', 'notes-doc'), deletedAt: new Date('2024-01-03') };
    mockAgentDocumentModel.findByIdWithOptions.mockResolvedValueOnce(root);
    mockAgentDocumentModel.findByDocumentId.mockResolvedValue(parent);
    mockAgentDocumentModel.listByParentAndFilename.mockImplementation(
      async (_agentId, parentId, filename) => {
        if (parentId === null && filename === 'notes') return [parent];
        if (parentId === 'notes-doc' && filename === 'todo.md') return [root];
        return [];
      },
    );

    const service = new AgentDocumentVfsService(db, userId);
    const restored = await service.restoreFromTrash('agent-todo-doc', { agentId: 'agent-1' });

    expect(mockAgentDocumentModel.restore.mock.calls).toEqual([
      ['agent-notes-doc'],
      ['agent-todo-doc'],
    ]);
    expect(restored).toEqual(expect.objectContaining({ path: './notes/todo.md' }));

    mockAgentDocumentModel.findByIdWithOptions.mockResolvedValueOnce({
      ...root,
      deletedAt: null,
    });
    await expect(
      service.restoreFromTrash('agent-todo-doc', { agentId: 'agent-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    mockAgentDocumentModel.findByIdWithOptions.mockResolvedValueOnce(undefined);
    await expect(
      service.deletePermanently('agent-todo-doc', { agentId: 'agent-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
