import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { artboardFiles, artboards } from '../../schemas/artboard';
import type { Transaction } from '../../type';
import { accessibleArtboardIds, type ArtboardDatabase } from './index';
import type { ArtboardFileRow } from './types';

export interface ArtboardFileEntry {
  contentType: string;
  hash: string;
  path: string;
  size: number;
}

export class ArtboardFileModel {
  constructor(
    private db: ArtboardDatabase,
    private userId: string,
    private workspaceId?: string,
  ) {}

  withTransaction = (tx: Transaction) => new ArtboardFileModel(tx, this.userId, this.workspaceId);

  private accessible = () =>
    accessibleArtboardIds(this.db, { userId: this.userId, workspaceId: this.workspaceId });

  list = (artboardId: string): Promise<ArtboardFileRow[]> =>
    this.db
      .select()
      .from(artboardFiles)
      .where(
        and(
          eq(artboardFiles.artboardId, artboardId),
          inArray(artboardFiles.artboardId, this.accessible()),
        ),
      )
      .orderBy(asc(artboardFiles.path));

  async upsert(artboardId: string, entries: ArtboardFileEntry[]) {
    if (!entries.length) return;
    const [owner] = await this.db
      .select({ userId: artboards.userId, workspaceId: artboards.workspaceId })
      .from(artboards)
      .where(and(eq(artboards.id, artboardId), inArray(artboards.id, this.accessible())))
      .limit(1);
    if (!owner) throw new Error(`Artboard "${artboardId}" was not found`);

    await this.db
      .insert(artboardFiles)
      .values(entries.map((entry) => ({ ...entry, ...owner, artboardId })))
      .onConflictDoUpdate({
        set: {
          contentType: sql`excluded.content_type`,
          hash: sql`excluded.hash`,
          size: sql`excluded.size`,
          updatedAt: sql`now()`,
        },
        target: [artboardFiles.artboardId, artboardFiles.path],
      });
  }

  async delete(artboardId: string, paths: string[]) {
    if (!paths.length) return;
    await this.db
      .delete(artboardFiles)
      .where(
        and(
          eq(artboardFiles.artboardId, artboardId),
          inArray(artboardFiles.path, paths),
          inArray(artboardFiles.artboardId, this.accessible()),
        ),
      );
  }
}
