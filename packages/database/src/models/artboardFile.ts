import { FileSource } from '@lobechat/types';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { files } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export interface ArtboardStoredFile {
  contentType: string;
  key: string;
  path: string;
  size: number;
}

const artboardIdField = sql<string | null>`${files.metadata} ->> 'artboardId'`;
const pathField = sql<string | null>`${files.metadata} ->> 'path'`;

export class ArtboardFileModel {
  constructor(
    private db: LobeChatDatabase | Transaction,
    private userId: string,
    private workspaceId?: string,
  ) {}

  // Any member may write a workspace board, so a row is matched by board, not by writer.
  private boardRows = (artboardIds: string[]) =>
    and(
      buildWorkspaceWhere(
        { userId: this.userId, workspaceId: this.workspaceId },
        { userId: files.userId, workspaceId: files.workspaceId },
      ),
      eq(files.source, FileSource.Artboard),
      inArray(artboardIdField, artboardIds),
    );

  record = async (artboardId: string, stored: ArtboardStoredFile[], deleted: string[]) => {
    const paths = [...stored.map((file) => file.path), ...deleted];
    if (paths.length === 0) return;

    await this.db.transaction(async (tx) => {
      await tx.delete(files).where(and(this.boardRows([artboardId]), inArray(pathField, paths)));
      if (stored.length === 0) return;
      await tx.insert(files).values(
        stored.map((file) =>
          buildWorkspacePayload(
            { userId: this.userId, workspaceId: this.workspaceId },
            {
              fileType: file.contentType,
              metadata: { artboardId, path: file.path },
              name: file.path.slice(file.path.lastIndexOf('/') + 1),
              size: file.size,
              source: FileSource.Artboard,
              url: file.key,
            },
          ),
        ),
      );
    });
  };

  deleteByArtboards = async (artboardIds: string[]) => {
    if (artboardIds.length === 0) return;
    await this.db.delete(files).where(this.boardRows(artboardIds));
  };
}
