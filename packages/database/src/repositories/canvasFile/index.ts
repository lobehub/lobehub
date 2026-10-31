import type { CanvasStorageItem } from '@lobechat/types';
import { and, eq, inArray } from 'drizzle-orm';

import { type CanvasBlobRecord, CanvasFileModel } from '../../models/canvasFile';
import { globalFiles, works } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

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

  private canvasWorks = () =>
    and(
      buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, works),
      eq(works.userId, this.userId),
      eq(works.resourceType, 'canvas'),
    );

  /**
   * The caller's Work for a canvas in the active space, regardless of the
   * share-scope filter the Work surfaces apply: any Work at all means the
   * canvas's files are not leftovers.
   */
  findCanvasWorkId = async (canvasId: string): Promise<string | null> => {
    const [row] = await this.db
      .select({ id: works.id })
      .from(works)
      .where(and(this.canvasWorks(), eq(works.resourceId, canvasId)))
      .limit(1);
    return row?.id ?? null;
  };

  /**
   * The caller's canvas file usage per canvas, named by the canvas Work that
   * owns it. The resource library hides canvas files, so this is the only place
   * that usage is visible. Files whose Work is gone still count and are listed
   * untitled, so they can be freed too.
   */
  listStorage = async (): Promise<CanvasStorageItem[]> => {
    const usage = await new CanvasFileModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).summarizeByCanvas();
    if (usage.length === 0) return [];

    const owners = await this.db
      .select({ id: works.id, resourceId: works.resourceId, title: works.title })
      .from(works)
      .where(
        and(
          this.canvasWorks(),
          inArray(
            works.resourceId,
            usage.map((row) => row.canvasId),
          ),
        ),
      );
    const workByCanvas = new Map(owners.map((row) => [row.resourceId, row]));

    return usage.map((row) => {
      const work = workByCanvas.get(row.canvasId);
      return { ...row, title: work?.title ?? null, workId: work?.id ?? null };
    });
  };
}
