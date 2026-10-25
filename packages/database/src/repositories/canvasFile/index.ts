import { type CanvasBlobRecord, CanvasFileModel } from '../../models/canvasFile';
import { globalFiles } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

export class CanvasFileRepository {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  register = async (canvasId: string, blobs: CanvasBlobRecord[]) => {
    const model = new CanvasFileModel(this.db, this.userId, this.workspaceId);
    const existing = new Set(
      (await model.listByHashes(blobs.map((item) => item.hash)))
        .filter((row) => row.canvasId === canvasId)
        .map((row) => row.fileHash),
    );
    const fresh = blobs.filter((item) => !existing.has(item.hash));
    if (fresh.length === 0) return;

    await this.db.transaction(async (tx) => {
      await tx
        .insert(globalFiles)
        .values(
          fresh.map((item) => ({
            creator: this.userId,
            fileType: item.contentType,
            hashId: item.hash,
            size: item.size,
            url: item.url,
          })),
        )
        .onConflictDoNothing();

      await new CanvasFileModel(tx, this.userId, this.workspaceId).insertFiles(canvasId, fresh);
    });
  };
}
