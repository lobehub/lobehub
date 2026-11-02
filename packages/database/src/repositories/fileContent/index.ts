import { and, eq, inArray } from 'drizzle-orm';

import { FileModel } from '../../models/file';
import { asyncTasks, documents, type FileItem } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

export class FileContentRepository {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  /**
   * Point a row at the new content of its overwritten storage object, dropping
   * parsed data so later reads cannot return the previous version.
   */
  replaceStoredContent = async (file: FileItem, value: Pick<FileItem, 'fileType' | 'size'>) => {
    await this.db.transaction(async (tx) => {
      const fileModel = new FileModel(tx, this.userId, this.workspaceId);

      await fileModel.deleteFileChunks(tx as any, [file.id]);
      await tx
        .delete(documents)
        .where(
          and(
            eq(documents.fileId, file.id),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents),
            eq(documents.sourceType, 'file'),
          ),
        );

      const taskIds = [file.chunkTaskId, file.embeddingTaskId].filter((taskId): taskId is string =>
        Boolean(taskId),
      );
      if (taskIds.length > 0) {
        await tx.delete(asyncTasks).where(inArray(asyncTasks.id, taskIds));
      }

      await fileModel.update(file.id, value);
    });
  };
}
