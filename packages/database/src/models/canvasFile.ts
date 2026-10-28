import { FileSource } from '@lobechat/types';
import { and, count, desc, eq, inArray, isNotNull, max, sql, sum } from 'drizzle-orm';

import { files } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export interface CanvasBlobRecord {
  contentType: string;
  hash: string;
  name: string;
  size: number;
  url: string;
}

const canvasIdField = sql<string | null>`${files.metadata} ->> 'canvasId'`;

export class CanvasFileModel {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    and(
      buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, files),
      eq(files.userId, this.userId),
      eq(files.source, FileSource.Canvas),
    );

  listByHashes = async (hashes: string[]) => {
    if (hashes.length === 0) return [];

    return this.db
      .select({ canvasId: canvasIdField, fileHash: files.fileHash, id: files.id, url: files.url })
      .from(files)
      .where(and(this.ownership(), inArray(files.fileHash, hashes)));
  };

  /** Whether the caller still holds any file of this canvas in the active space. */
  hasCanvasFiles = async (canvasId: string) => {
    const [row] = await this.db
      .select({ id: files.id })
      .from(files)
      .where(and(this.ownership(), eq(canvasIdField, canvasId)))
      .limit(1);
    return !!row;
  };

  /** Bytes and blob count each of the caller's canvases holds, largest first. */
  summarizeByCanvas = async () => {
    const rows = await this.db
      .select({
        canvasId: canvasIdField,
        fileCount: count(),
        totalSize: sum(files.size).mapWith(Number),
        updatedAt: max(files.updatedAt),
      })
      .from(files)
      .where(and(this.ownership(), isNotNull(canvasIdField)))
      .groupBy(canvasIdField)
      .orderBy(desc(sum(files.size)));

    return rows.map((row) => ({
      canvasId: row.canvasId!,
      fileCount: row.fileCount,
      totalSize: row.totalSize ?? 0,
      updatedAt: row.updatedAt!,
    }));
  };

  insertFiles = async (canvasId: string, blobs: CanvasBlobRecord[]) => {
    if (blobs.length === 0) return;

    await this.db.insert(files).values(
      blobs.map((item) =>
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          {
            fileHash: item.hash,
            fileType: item.contentType,
            metadata: { canvasId },
            name: item.name,
            size: item.size,
            source: FileSource.Canvas,
            url: item.url,
          },
        ),
      ),
    );
  };

  deleteByCanvas = async (canvasId: string): Promise<string[]> => {
    const removed = await this.db
      .delete(files)
      .where(and(this.ownership(), eq(canvasIdField, canvasId)))
      .returning({ url: files.url });

    const urls = [...new Set(removed.map((row) => row.url))];
    if (urls.length === 0) return [];

    const stillUsed = await this.db
      .select({ url: files.url })
      .from(files)
      .where(
        and(
          eq(files.userId, this.userId),
          eq(files.source, FileSource.Canvas),
          inArray(files.url, urls),
        ),
      );
    const used = new Set(stillUsed.map((row) => row.url));

    return urls.filter((url) => !used.has(url));
  };
}
