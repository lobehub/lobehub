import type { BlobRef, BlobStore } from '@lobechat/agent-runtime';
import type { LobeChatDatabase } from '@lobechat/database';

import { FileService } from '@/server/services/file';

export class ServerBlobStore implements BlobStore {
  private readonly fileService: FileService;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.fileService = new FileService(db, userId, workspaceId);
  }

  persistBase64(base64Data: string, pathname: string) {
    return this.fileService.uploadBase64(base64Data, pathname);
  }

  resolveUrl(ref: BlobRef) {
    return this.fileService.getFileAccessUrl(ref);
  }
}
