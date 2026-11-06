// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadRouter } from './upload';

const mocks = vi.hoisted(() => {
  const transaction = {};
  const state = { inTransaction: false };
  return {
    checkHash: vi.fn(),
    create: vi.fn(),
    getFileAccessUrl: vi.fn(),
    getFileMetadata: vi.fn(),
    serverDB: {
      transaction: vi.fn(async (callback: (trx: unknown) => unknown) => {
        state.inTransaction = true;
        try {
          return await callback(transaction);
        } finally {
          state.inTransaction = false;
        }
      }),
    },
    state,
    transaction,
    updateGlobalFile: vi.fn(),
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
  FileModel: vi.fn(function () {
    return {
      checkHash: mocks.checkHash,
      create: mocks.create,
      updateGlobalFile: mocks.updateGlobalFile,
    };
  }),
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return {
      getFileAccessUrl: mocks.getFileAccessUrl,
      getFileMetadata: mocks.getFileMetadata,
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
  fileType: 'text',
  hash: 'test-hash',
  metadata: { path: 'new/path.txt' },
  name: 'test.txt',
  size: 100,
  url: 'new/path.txt',
};

const caller = () =>
  uploadRouter.createCaller({ userId: 'user-1' } as Parameters<
    typeof uploadRouter.createCaller
  >[0]);

/**
 * An existing hash row whose stored object is gone follows a fresh upload of the same bytes, so
 * dedup checks stop resolving to the dead key. The storage probe deciding that runs before the
 * record transaction, and only applies to the row it probed.
 */
describe('uploadRouter.createFile global hash pointer', () => {
  const probedInTransaction: boolean[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    probedInTransaction.length = 0;
    mocks.create.mockResolvedValue({ id: 'new-file-id' });
    mocks.getFileAccessUrl.mockImplementation(async ({ id }: { id: string }) => {
      expect(mocks.state.inTransaction).toBe(false);
      return `https://lobehub.com/f/${id}`;
    });
    // The uploaded object itself is present; `old/path.txt` is the hash row's previous object.
    mocks.getFileMetadata.mockImplementation(async (url: string) => {
      if (url !== 'old/path.txt') return { contentLength: 100, contentType: 'text/plain' };
      probedInTransaction.push(mocks.state.inTransaction);
      throw new Error('NoSuchKey');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.error).mockRestore();
  });

  it('moves the pointer of a missing object to the upload, probing outside the transaction', async () => {
    mocks.checkHash.mockResolvedValue({ isExist: true, url: 'old/path.txt' });

    await caller().createFile(upload);

    expect(probedInTransaction).toEqual([false]);
    expect(mocks.checkHash).toHaveBeenLastCalledWith('test-hash', mocks.transaction);
    expect(mocks.updateGlobalFile).toHaveBeenCalledWith(
      'test-hash',
      { metadata: { path: 'new/path.txt' }, url: 'new/path.txt' },
      mocks.transaction,
    );
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ fileHash: 'test-hash', url: 'new/path.txt' }),
      false,
      mocks.transaction,
    );
  });

  it('keeps the pointer while its object is still available', async () => {
    mocks.checkHash.mockResolvedValue({ isExist: true, url: 'old/path.txt' });
    mocks.getFileMetadata.mockResolvedValue({ contentLength: 100, contentType: 'text/plain' });

    await caller().createFile(upload);

    expect(mocks.updateGlobalFile).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ fileHash: 'test-hash', url: 'new/path.txt' }),
      false,
      mocks.transaction,
    );
  });

  it('does not apply a probe of a pointer that another upload replaced meanwhile', async () => {
    mocks.checkHash
      .mockResolvedValueOnce({ isExist: true, url: 'old/path.txt' })
      .mockResolvedValueOnce({ isExist: true, url: 'other/path.txt' });

    await caller().createFile(upload);

    expect(mocks.updateGlobalFile).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith(expect.anything(), false, mocks.transaction);
  });

  it('recreates the global row when the probed hash row was removed meanwhile', async () => {
    mocks.checkHash
      .mockResolvedValueOnce({ isExist: true, url: 'old/path.txt' })
      .mockResolvedValueOnce({ isExist: false });

    await caller().createFile(upload);

    expect(mocks.updateGlobalFile).not.toHaveBeenCalled();
    // files.file_hash references global_files, so the row must exist when the file row lands.
    expect(mocks.create).toHaveBeenCalledWith(expect.anything(), true, mocks.transaction);
  });
});
