// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileSource, LIBRARY_HIDDEN_FILE_SOURCES } from '@/types/files';

import { uploadRouter } from './upload';

const mocks = vi.hoisted(() => {
  const transaction = {};
  return {
    checkHash: vi.fn(),
    create: vi.fn(),
    getAgentVisibility: vi.fn(),
    serverDB: {
      transaction: vi.fn(async (callback: (trx: unknown) => unknown) => callback(transaction)),
    },
    transaction,
  };
});

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => mocks.serverDB) }));
vi.mock('@/business/server/lambda-routers/file', () => ({
  businessFileUploadCheck: vi.fn(),
}));
vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return { getAgentVisibility: mocks.getAgentVisibility };
  }),
}));
vi.mock('@/database/models/asyncTask', () => ({ AsyncTaskModel: vi.fn() }));
vi.mock('@/database/models/chunk', () => ({ ChunkModel: vi.fn() }));
vi.mock('@/database/models/document', () => ({ DocumentModel: vi.fn() }));
vi.mock('@/database/models/knowledgeBase', () => ({ KnowledgeBaseModel: vi.fn() }));
vi.mock('@/database/repositories/knowledge', () => ({ KnowledgeRepo: vi.fn() }));
vi.mock('@/server/services/document', () => ({ DocumentService: vi.fn() }));
vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(function () {
    return { checkHash: mocks.checkHash, create: mocks.create };
  }),
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return {
      getFileAccessUrl: vi.fn(async ({ id }: { id: string }) => `https://lobehub.com/f/${id}`),
      getFileMetadata: vi.fn().mockResolvedValue({ contentLength: 100 }),
    };
  }),
}));
vi.mock('@/server/services/fileUpload', () => ({
  FileUploadService: vi.fn(function () {
    return {
      findLatest: vi.fn().mockResolvedValue(undefined),
      hasAnyLiveSession: vi.fn().mockResolvedValue(false),
    };
  }),
}));

const upload = {
  conversationAgentId: 'agent-1',
  fileType: 'application/pdf',
  hash: 'attachment-hash',
  metadata: {},
  name: 'notes.pdf',
  size: 100,
  url: 'files/notes.pdf',
};

const workspaceCaller = (extra: Record<string, unknown> = {}) =>
  uploadRouter.createCaller({ userId: 'uploader', workspaceId: 'workspace-1', ...extra } as any);

const expectCreated = (expected: Record<string, unknown>) =>
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining(expected),
    true,
    mocks.transaction,
  );

describe('uploadRouter.createFile for a conversation attachment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkHash.mockResolvedValue({ isExist: false });
    mocks.create.mockResolvedValue({ id: 'attachment' });
  });

  it('shares the attachment with readers of a public agent, outside the library', async () => {
    // Regression: the upload defaulted to private while every member could read
    // the conversation, so the card tombstoned for everyone but the uploader.
    mocks.getAgentVisibility.mockResolvedValue('public');

    await workspaceCaller().createFile(upload);

    expect(mocks.getAgentVisibility).toHaveBeenCalledWith('agent-1');
    expectCreated({ source: FileSource.ChatAttachment, visibility: 'public' });
    expect(LIBRARY_HIDDEN_FILE_SOURCES).toContain(FileSource.ChatAttachment);
  });

  it.each([['private'], [null]])('stays private for an agent resolving to %s', async (agent) => {
    mocks.getAgentVisibility.mockResolvedValue(agent);

    await workspaceCaller().createFile(upload);

    expectCreated({ source: undefined, visibility: 'private' });
  });

  it.each([
    ['an explicit private request', { visibility: 'private' as const }, undefined],
    ['its own source', { source: FileSource.PageEditor }, FileSource.PageEditor],
  ])('keeps %s private in a public agent', async (_label, extra, source) => {
    mocks.getAgentVisibility.mockResolvedValue('public');

    await workspaceCaller().createFile({ ...upload, ...extra });

    expectCreated({ source, visibility: 'private' });
  });

  it('never lets a run operation token publish an attachment', async () => {
    mocks.getAgentVisibility.mockResolvedValue('public');

    await workspaceCaller({ heteroOperationScope: 'op_task_run' }).createFile(upload);

    expectCreated({ source: FileSource.Acceptance, visibility: 'private' });
  });

  it('leaves personal mode untouched', async () => {
    mocks.getAgentVisibility.mockResolvedValue('public');

    await uploadRouter.createCaller({ userId: 'uploader' } as any).createFile(upload);

    expect(mocks.getAgentVisibility).not.toHaveBeenCalled();
    expect(mocks.create.mock.lastCall?.[0]).toMatchObject({ source: undefined });
    expect(mocks.create.mock.lastCall?.[0]).not.toHaveProperty('visibility');
  });
});
