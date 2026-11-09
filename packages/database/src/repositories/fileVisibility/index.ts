import { sql } from 'drizzle-orm';

import { DocumentModel } from '../../models/document';
import { FileModel } from '../../models/file';
import type { LobeChatDatabase } from '../../type';

/**
 * Publish / unpublish a file.
 *
 * File visibility spans two aggregates: the `files` row the resource list
 * renders, and the `documents` rows parsed from that file, which are searchable
 * on their own. Each aggregate keeps its own single-aggregate Model method
 * (`FileModel.setVisibility`, `DocumentModel.setVisibilityByFileId`); this
 * repository owns the transaction that keeps them in step.
 */
export class FileVisibilityRepository {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  setVisibility = async (fileId: string, visibility: 'private' | 'public') => {
    return this.db.transaction(async (trx) => {
      const db = trx as LobeChatDatabase;

      // `DocumentService.parseFile` takes this same per-file advisory lock before
      // it re-reads the file's visibility and inserts the parsed document. Taking
      // it here serializes the two: a publish that starts mid-parse waits for the
      // insert and then flips the new row below, instead of committing between
      // the parse's visibility read and its write and leaving the text behind.
      await db.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`parseFile:${fileId}`})::bigint)`,
      );

      const updated = await new FileModel(db, this.userId, this.workspaceId).setVisibility(
        fileId,
        visibility,
      );

      // Text parsed from the file is searchable on its own, so it follows the file. Any member's
      // read may have produced it, and the file update above already authorized this. Scope by
      // tenant only: a visibility-aware filter would hide another member's private row.
      if (updated.length > 0) {
        await new DocumentModel(db, this.userId, this.workspaceId).setVisibilityByFileId(
          fileId,
          visibility,
        );
      }

      return updated;
    });
  };

  /**
   * Publish one private file into the workspace; thin wrapper around
   * `setVisibility(fileId, 'public')`.
   */
  publishToWorkspace = async (fileId: string) => this.setVisibility(fileId, 'public');
}
