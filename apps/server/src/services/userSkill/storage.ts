import type { LobeChatDatabase } from '@lobechat/database';

import { FileService } from '../file';

interface StorageOwner {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

/**
 * Object storage a user skill's package goes through: the archives its
 * versions publish, and the bytes of its binary files. One seam, so tests can
 * stand in for storage without an S3 behind it.
 */
export const skillStorage = {
  read: (owner: StorageOwner, key: string): Promise<Uint8Array> =>
    new FileService(owner.db, owner.userId, owner.workspaceId).getFileByteArray(key),

  write: async (owner: StorageOwner, key: string, bytes: Uint8Array): Promise<void> => {
    await new FileService(owner.db, owner.userId, owner.workspaceId).uploadBuffer(
      key,
      Buffer.from(bytes),
      'application/zip',
    );
  },
};
