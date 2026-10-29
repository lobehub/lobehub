import { checkCanvasStorageQuota } from '@/business/server/canvasStorage';
import type { LobeChatDatabase } from '@/database/type';
import { FileService } from '@/server/services/file';

import { type CanvasBlobStore, CanvasStorageService } from './storage';

export * from './storage';

export const createFileServiceBlobStore = (fileService: FileService): CanvasBlobStore => ({
  delete: async (keys) => {
    await fileService.deleteFiles(keys);
  },
  read: (key) => fileService.getFileByteArray(key),
  write: async (key, bytes, contentType) => {
    await fileService.uploadBuffer(key, Buffer.from(bytes), contentType);
  },
});

export const createCanvasStorageService = (
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
) =>
  new CanvasStorageService({
    checkQuota: checkCanvasStorageQuota,
    db,
    store: createFileServiceBlobStore(new FileService(db, userId, workspaceId)),
    userId,
    workspaceId,
  });
