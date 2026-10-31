// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileSource } from '@/types/files';

import { uploadRouter } from './upload';

const mocks = vi.hoisted(() => {
  const transaction = {};
  return {
    checkHash: vi.fn(),
    create: vi.fn(),
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
vi.mock('@/database/models/asyncTask', () => ({ AsyncTaskModel: vi.fn() }));
vi.mock('@/database/models/chunk', () => ({ ChunkModel: vi.fn() }));
vi.mock('@/database/models/document', () => ({ DocumentModel: vi.fn() }));
vi.mock('@/database/models/knowledgeBase', () => ({ KnowledgeBaseModel: vi.fn() }));
vi.mock('@/database/repositories/knowledge', () => ({ KnowledgeRepo: vi.fn() }));
vi.mock('@/server/services/document', () => ({ DocumentService: vi.fn() }));
vi.mock('@/database/models/file', () => ({
  FileModel: Object.assign(
    vi.fn(function () {
      return { checkHash: mocks.checkHash, create: mocks.create };
    }),
    { addedStorageBytesForObject: vi.fn(async () => 0) },
  ),
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
  fileType: 'image/png',
  hash: 'evidence-hash',
  metadata: {},
  name: 'R11-ENV-recheck.png',
  size: 100,
  url: 'files/2026-10-21/evidence-hash.png',
};

const operationCaller = () =>
  uploadRouter.createCaller({
    heteroOperationScope: 'op_task_run',
    userId: 'operation-owner',
    workspaceId: 'workspace-1',
  } as any);

describe('uploadRouter.createFile with a run operation token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkHash.mockResolvedValue({ isExist: false });
    mocks.create.mockResolvedValue({ id: 'evidence-file' });
  });

  it('files the upload as private acceptance evidence', async () => {
    // The acceptance CLI uploads evidence with no source or visibility. Under the
    // run's token it must not land in the creator's resource library.
    await operationCaller().createFile(upload);

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: undefined,
        parentId: undefined,
        source: FileSource.Acceptance,
        visibility: 'private',
      }),
      true,
      mocks.transaction,
    );
  });

  it.each([
    ['a document parent', { parentId: 'docs_owner_folder' }],
    ['a knowledge base', { knowledgeBaseId: 'kb_owner' }],
    ['public visibility', { visibility: 'public' as const }],
    ['another source', { source: FileSource.PageEditor }],
  ])('refuses %s', async (_label, extra) => {
    await expect(operationCaller().createFile({ ...upload, ...extra })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('leaves a user session free to file into its library', async () => {
    await uploadRouter
      .createCaller({ userId: 'operation-owner', workspaceId: 'workspace-1' } as any)
      .createFile({ ...upload, source: FileSource.PageEditor, visibility: 'public' });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: FileSource.PageEditor, visibility: 'public' }),
      true,
      mocks.transaction,
    );
  });
});
