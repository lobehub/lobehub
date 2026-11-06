import type { LobeChatDatabase, Transaction } from '@lobechat/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileService } from './index';

const mocks = vi.hoisted(() => ({
  checkHash: vi.fn(),
  create: vi.fn(),
  deleteFile: vi.fn(),
  getFileMetadata: vi.fn(),
  state: { inTransaction: false },
  transaction: { name: 'record-tx' },
  updateGlobalFile: vi.fn(),
  uploadBuffer: vi.fn(),
}));

vi.mock('@/config/db', () => ({ serverDBEnv: { REMOVE_GLOBAL_FILE: false } }));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://lobehub.com' } }));
vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(function () {
    return {
      checkHash: mocks.checkHash,
      create: mocks.create,
      updateGlobalFile: mocks.updateGlobalFile,
    };
  }),
}));
vi.mock('./impls', () => ({
  createFileServiceModule: () => ({
    deleteFile: mocks.deleteFile,
    getFileMetadata: mocks.getFileMetadata,
    uploadBuffer: mocks.uploadBuffer,
  }),
}));

const upload = {
  fileHash: 'existing-hash',
  fileType: 'image/png',
  metadata: { path: 'images/new.png' },
  name: 'new.png',
  size: 5,
  url: 'images/new.png',
};

describe('FileService record transaction', () => {
  let service: FileService;
  const probedInTransaction: boolean[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.state.inTransaction = false;
    probedInTransaction.length = 0;
    const db = {
      transaction: async (run: (trx: unknown) => Promise<unknown>) => {
        mocks.state.inTransaction = true;
        try {
          return await run(mocks.transaction);
        } finally {
          mocks.state.inTransaction = false;
        }
      },
    } as unknown as LobeChatDatabase;
    service = new FileService(db, 'user-1');
    mocks.checkHash.mockResolvedValue({ isExist: true, url: 'images/old.png' });
    mocks.create.mockResolvedValue({ id: 'file-id' });
    mocks.uploadBuffer.mockResolvedValue({ key: upload.url });
    mocks.getFileMetadata.mockImplementation(async () => {
      probedInTransaction.push(mocks.state.inTransaction);
      throw new Error('NoSuchKey');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const write = (entry: string, beforeRecord?: (trx: Transaction) => Promise<void>) =>
    entry === 'createFileRecord'
      ? service.createFileRecord(upload)
      : service.uploadFromBuffer(Buffer.from('image'), upload.fileType, upload.url, beforeRecord);

  describe.each(['createFileRecord', 'uploadFromBuffer'])('%s', (entry) => {
    it('probes before opening the transaction and writes on one transaction', async () => {
      await write(entry);

      expect(probedInTransaction).toEqual([false]);
      expect(mocks.checkHash).toHaveBeenNthCalledWith(1, expect.any(String));
      expect(mocks.checkHash).toHaveBeenLastCalledWith(expect.any(String), mocks.transaction);
      expect(mocks.updateGlobalFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ url: upload.url }),
        mocks.transaction,
      );
      expect(mocks.create).toHaveBeenCalledWith(expect.anything(), false, mocks.transaction);
    });

    it('keeps an available global object', async () => {
      mocks.getFileMetadata.mockResolvedValue({ contentLength: 5 });

      await write(entry);

      expect(mocks.updateGlobalFile).not.toHaveBeenCalled();
      expect(mocks.create).toHaveBeenCalledWith(expect.anything(), false, mocks.transaction);
    });

    it('does not overwrite a hash pointer replaced after the probe', async () => {
      mocks.checkHash
        .mockResolvedValueOnce({ isExist: true, url: 'images/old.png' })
        .mockResolvedValueOnce({ isExist: true, url: 'images/other.png' });

      await write(entry);

      expect(mocks.getFileMetadata).toHaveBeenCalledWith('images/old.png');
      expect(mocks.updateGlobalFile).not.toHaveBeenCalled();
      expect(mocks.create).toHaveBeenCalledWith(expect.anything(), false, mocks.transaction);
    });

    it('recreates a global row removed after the probe', async () => {
      mocks.checkHash
        .mockResolvedValueOnce({ isExist: true, url: 'images/old.png' })
        .mockResolvedValueOnce({ isExist: false });

      await write(entry);

      expect(mocks.updateGlobalFile).not.toHaveBeenCalled();
      expect(mocks.create).toHaveBeenCalledWith(expect.anything(), true, mocks.transaction);
    });

    it('resolves the access URL after the transaction commits', async () => {
      const resolvedInTransaction: boolean[] = [];
      vi.spyOn(service, 'getFileAccessUrl').mockImplementation(async () => {
        resolvedInTransaction.push(mocks.state.inTransaction);
        return 'https://lobehub.com/f/file-id';
      });

      const result = await write(entry);

      expect(resolvedInTransaction).toEqual([false]);
      expect(result).toMatchObject({ fileId: 'file-id', url: 'https://lobehub.com/f/file-id' });
    });
  });

  it('runs the admission check inside the same record transaction', async () => {
    const beforeRecord = vi.fn(async (trx: Transaction) => {
      expect(mocks.state.inTransaction).toBe(true);
      expect(trx).toBe(mocks.transaction);
      expect(mocks.create).not.toHaveBeenCalled();
    });

    await write('uploadFromBuffer', beforeRecord);

    expect(beforeRecord).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(expect.anything(), false, mocks.transaction);
  });

  it.each(['admission', 'hash read', 'record write'])(
    'removes the upload on %s failure',
    async (stage) => {
      const error = new Error(`${stage} failed`);
      const beforeRecord = vi.fn(async () => {
        if (stage === 'admission') throw error;
      });
      if (stage === 'hash read') mocks.checkHash.mockRejectedValueOnce(error);
      if (stage === 'record write') mocks.create.mockRejectedValueOnce(error);

      await expect(write('uploadFromBuffer', beforeRecord)).rejects.toBe(error);

      expect(mocks.deleteFile).toHaveBeenCalledWith(upload.url);
    },
  );

  it('preserves the committed object when access URL generation fails', async () => {
    const error = new Error('URL generation failed');
    vi.spyOn(service, 'getFileAccessUrl').mockRejectedValue(error);

    await expect(write('uploadFromBuffer')).rejects.toBe(error);

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });
});
