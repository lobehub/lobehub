// @vitest-environment node
import { AGENT_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentAccess } from '@/database/models/agentDocuments';

import * as headlessEditor from '../agentDocuments/headlessEditor';
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

  it('creates a new ordinary file through write when the path is missing', async () => {
    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(undefined);
    mockAgentDocumentModel.listByParentAndFilename.mockResolvedValue([]);
    mockAgentDocumentModel.create.mockResolvedValue({
      accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
      content: 'hello',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      documentId: 'documents-2',
      fileType: AGENT_DOCUMENT_FILE_TYPE,
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

  it('stores raw ordinary file content without Markdown serialization', async () => {
    const content = `<knowledge_base_files totalCount="1">
<file id="file-1" name="raw.txt">
${'lossless tool result\n'.repeat(100)}
</file>
</knowledge_base_files>`;
    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(undefined);
    mockAgentDocumentModel.listByParentAndFilename.mockResolvedValue([]);
    mockAgentDocumentModel.create.mockResolvedValue({
      accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
      content,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      documentId: 'documents-raw',
      fileType: 'text/plain',
      filename: 'archive.txt',
      id: 'agent-doc-raw',
      metadata: null,
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    });
    const createSnapshotSpy = vi.spyOn(headlessEditor, 'createAgentMarkdownSnapshot');
    const service = new AgentDocumentVfsService(db, userId);
    const node = await service.write(
      './archive.txt',
      content,
      { agentId: 'agent-1' },
      {
        contentFormat: 'raw',
      },
    );

    expect(createSnapshotSpy).not.toHaveBeenCalled();
    expect(node.contentType).toBe('text/plain');
    expect(mockAgentDocumentModel.create).toHaveBeenCalledWith('agent-1', 'archive.txt', content, {
      fileType: 'text/plain',
      parentId: null,
      title: 'archive.txt',
    });
  });

  it('overwrites raw ordinary file content without Markdown serialization', async () => {
    const existing = {
      accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
      content: 'old content',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      documentId: 'documents-raw',
      fileType: 'text/plain',
      filename: 'archive.txt',
      id: 'agent-doc-raw',
      metadata: null,
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    };
    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(existing);
    mockAgentDocumentModel.update.mockImplementation(async (_id, params) => {
      Object.assign(existing, params);
    });
    const createSnapshotSpy = vi.spyOn(headlessEditor, 'createAgentMarkdownSnapshot');
    const service = new AgentDocumentVfsService(db, userId);

    await service.write(
      './archive.txt',
      'new raw content',
      { agentId: 'agent-1' },
      {
        contentFormat: 'raw',
      },
    );

    expect(createSnapshotSpy).not.toHaveBeenCalled();
    expect(mockAgentDocumentModel.update).toHaveBeenCalledWith('agent-doc-raw', {
      content: 'new raw content',
      editorData: null,
      fileType: 'text/plain',
    });
  });

  it('resolves duplicate ordinary path segments to the oldest sibling', async () => {
    mockAgentDocumentModel.listByParentAndFilename.mockResolvedValue([
      {
        accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
        content: 'first',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        documentId: 'documents-first',
        fileType: AGENT_DOCUMENT_FILE_TYPE,
        filename: 'notes.md',
        id: 'agent-doc-first',
      },
      {
        accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
        content: 'second',
        createdAt: new Date('2024-01-02T00:00:00.000Z'),
        documentId: 'documents-second',
        fileType: AGENT_DOCUMENT_FILE_TYPE,
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

  it.each(['./', './lobe', './lobe/notes.md'])(
    'rejects writes to the reserved path %s',
    async (path) => {
      const service = new AgentDocumentVfsService(db, userId);

      await expect(service.write(path, 'x', { agentId: 'agent-1' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      await expect(service.mkdir(path, { agentId: 'agent-1' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      expect(mockAgentDocumentModel.create).not.toHaveBeenCalled();
    },
  );

  it('enforces createMode for ordinary writes', async () => {
    const service = new AgentDocumentVfsService(db, userId);

    await expect(
      service.write('./missing.md', 'x', { agentId: 'agent-1' }, { createMode: 'must-exist' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(fileDoc('a.md', 'doc-1'));
    await expect(
      service.write('./a.md', 'x', { agentId: 'agent-1' }, { createMode: 'always-new' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(folderDoc('dir', 'f-1'));
    await expect(service.write('./dir', 'x', { agentId: 'agent-1' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(mockAgentDocumentModel.update).not.toHaveBeenCalled();
    expect(mockAgentDocumentModel.create).not.toHaveBeenCalled();
  });

  it('rejects ordinary writes whose parent is missing or is a file', async () => {
    const service = new AgentDocumentVfsService(db, userId);

    await expect(service.write('./missing/a.md', 'x', { agentId: 'agent-1' })).rejects.toThrow(
      'Parent path not found: ./missing',
    );

    mockAgentDocumentModel.listByParentAndFilename.mockImplementation(
      async (_agentId, parentId, filename) =>
        parentId === null && filename === 'file.md' ? [fileDoc('file.md', 'doc-1')] : [],
    );
    await expect(service.write('./file.md/a.md', 'x', { agentId: 'agent-1' })).rejects.toThrow(
      'Parent path is not a directory: ./file.md',
    );
  });

  it('rejects mkdir through a missing parent unless recursive is set', async () => {
    const service = new AgentDocumentVfsService(db, userId);

    await expect(service.mkdir('./a/b', { agentId: 'agent-1' })).rejects.toThrow(
      'Parent path not found: ./a',
    );
    expect(mockAgentDocumentModel.create).not.toHaveBeenCalled();

    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(fileDoc('a', 'doc-1'));
    await expect(
      service.mkdir('./a/b', { agentId: 'agent-1' }, { recursive: true }),
    ).rejects.toThrow('Path segment is not a directory: ./a');
    await expect(
      service.mkdir('./lobe/skills/agent/skills/x', { agentId: 'agent-1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('creates a missing agent skill through write and enforces mounted createMode', async () => {
    const { AgentDocumentVfsError } = await import('./errors');
    mockSkillMount.get.mockRejectedValue(new AgentDocumentVfsError('missing', 'NOT_FOUND'));
    mockSkillMount.create.mockResolvedValue({
      content: '# New',
      name: 'SKILL.md',
      namespace: 'agent',
      path: './lobe/skills/agent/skills/writer/SKILL.md',
      type: 'file',
    });

    const service = new AgentDocumentVfsService(db, userId);
    const ctx = { agentId: 'agent-1', topicId: 'topic-1' };

    await expect(
      service.write('./lobe/skills/agent/skills/writer/SKILL.md', '# New', ctx, {
        createMode: 'must-exist',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const node = await service.write('./lobe/skills/agent/skills/writer/SKILL.md', '# New', ctx);

    expect(mockSkillMount.create).toHaveBeenCalledWith({
      agentId: 'agent-1',
      content: '# New',
      skillName: 'writer',
      targetNamespace: 'agent',
      topicId: 'topic-1',
    });
    expect(node).toEqual(expect.objectContaining({ id: expect.stringMatching(/^skills:agent:/) }));

    await expect(
      service.write('./lobe/skills/builtin/skills/lobehub/SKILL.md', 'x', ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    mockSkillMount.get.mockResolvedValue({ name: 'SKILL.md', namespace: 'agent', type: 'file' });
    await expect(
      service.write('./lobe/skills/agent/skills/writer/SKILL.md', 'x', ctx, {
        createMode: 'always-new',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
