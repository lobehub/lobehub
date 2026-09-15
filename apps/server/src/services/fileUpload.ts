import { TRPCError } from '@trpc/server';
import pMap from 'p-map';

import { FileUploadModel } from '@/database/models/fileUpload';
import type { FileUploadItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { FileS3 } from '@/server/modules/S3';

export const FILE_UPLOAD_SESSION_TTL = 2 * 60 * 60 * 1000;
export const FILE_UPLOAD_CLEANUP_LEASE = 15 * 60 * 1000;
export const FILE_UPLOAD_TERMINAL_RETENTION = 7 * 24 * 60 * 60 * 1000;
export const FILE_UPLOAD_CLEANUP_BATCH_SIZE = 500;

type UploadStorage = Pick<FileS3, 'abortMultipartUpload' | 'deleteFile'>;

const isMissingMultipartUpload = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;

  const value = error as { $metadata?: { httpStatusCode?: number }; name?: string };
  return value.name === 'NoSuchUpload' || value.$metadata?.httpStatusCode === 404;
};

const removeUploadObject = async (storage: UploadStorage, upload: FileUploadItem) => {
  if (upload.multipartUploadId) {
    try {
      await storage.abortMultipartUpload(upload.pathname, upload.multipartUploadId);
    } catch (error) {
      if (!isMissingMultipartUpload(error)) throw error;
    }
  }

  await storage.deleteFile(upload.pathname);
};

export class FileUploadService {
  readonly model: FileUploadModel;

  private storage?: UploadStorage;

  constructor(
    private readonly db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    storage?: UploadStorage,
  ) {
    this.model = new FileUploadModel(db, userId, workspaceId);
    this.storage = storage;
  }

  private getStorage = (): UploadStorage => {
    this.storage ??= new FileS3();
    return this.storage;
  };

  findLatest = (pathname: string) => this.model.findLatestByPathname(pathname);

  hasAnyLiveSession = (pathname: string) => FileUploadModel.hasLivePathname(this.db, pathname);

  touchActive = async (pathname: string): Promise<FileUploadItem | undefined> =>
    this.model.touchActive(pathname, new Date(Date.now() + FILE_UPLOAD_SESSION_TTL));

  assertActiveOrLegacy = async (pathname: string): Promise<FileUploadItem | undefined> => {
    const active = await this.touchActive(pathname);
    if (active) return active;

    const latest = await this.findLatest(pathname);
    if (latest) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Upload session is no longer active' });
    }
    if (await this.hasAnyLiveSession(pathname)) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Upload pathname belongs to another session',
      });
    }

    return undefined;
  };

  release = async (pathname: string): Promise<boolean> => {
    const claimed = await this.db.transaction((transaction) =>
      this.model.claimActiveForCleanup(pathname, transaction),
    );

    if (!claimed) return false;

    await removeUploadObject(this.getStorage(), claimed);
    await this.model.markReleased(claimed.id);
    return true;
  };

  releaseBestEffort = async (pathname: string): Promise<void> => {
    try {
      await this.release(pathname);
    } catch (error) {
      console.error('[file-upload:release] Failed to clean upload session', error);
    }
  };
}

export const sweepFileUploads = async (
  db: LobeChatDatabase,
  options: {
    batchSize?: number;
    now?: Date;
    storage?: UploadStorage;
  } = {},
) => {
  const batchSize = options.batchSize ?? FILE_UPLOAD_CLEANUP_BATCH_SIZE;
  const now = options.now ?? new Date();
  const storage = options.storage ?? new FileS3();
  const claimed = await FileUploadModel.claimExpiredBatch(db, {
    batchSize,
    cleanupLeaseBefore: new Date(now.getTime() - FILE_UPLOAD_CLEANUP_LEASE),
    expiresBefore: now,
  });

  let expired = 0;
  let failed = 0;

  await pMap(
    claimed,
    async (upload) => {
      try {
        await removeUploadObject(storage, upload);
        await FileUploadModel.markExpired(db, upload.id);
        expired += 1;
      } catch (error) {
        failed += 1;
        console.error(`[file-upload:sweep] Cleanup failed: uploadId=${upload.id}`, error);
      }
    },
    { concurrency: 10 },
  );

  const deleted = await FileUploadModel.deleteTerminalBatch(db, {
    batchSize,
    updatedBefore: new Date(now.getTime() - FILE_UPLOAD_TERMINAL_RETENTION),
  });

  return { claimed: claimed.length, deleted, expired, failed };
};
