import { AsyncTaskStatus } from '@lobechat/types';
import { and, eq, inArray } from 'drizzle-orm';

import { FileModel } from '../../models/file';
import { asyncTasks, documents, type FileItem, files } from '../../schemas';
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
   * Point the rows of a storage key at its overwritten object, dropping parsed
   * data so later reads cannot return the previous version.
   *
   * Resolves to the newest row's id, or `undefined` when nothing can be reused:
   * no row owns the key, or a task that may have read the old object is running
   * and would write its chunks back after this cleanup. A task started after the
   * overwrite reads the new object, so checking here leaves no stale writer.
   */
  replaceStoredContent = async (
    url: string,
    value: Pick<FileItem, 'fileType' | 'size'>,
  ): Promise<string | undefined> => {
    return this.db.transaction(async (tx) => {
      const fileModel = new FileModel(tx, this.userId, this.workspaceId);
      const rows = await fileModel.findManyByUrl(url);
      if (rows.length === 0) return;

      const fileIds = rows.map((file) => file.id);
      const taskIds = rows
        .flatMap((file) => [file.chunkTaskId, file.embeddingTaskId])
        .filter((taskId): taskId is string => Boolean(taskId));

      if (taskIds.length > 0) {
        const [runningTask] = await tx
          .select({ id: asyncTasks.id })
          .from(asyncTasks)
          .where(
            and(
              inArray(asyncTasks.id, taskIds),
              inArray(asyncTasks.status, [AsyncTaskStatus.Pending, AsyncTaskStatus.Processing]),
            ),
          )
          .limit(1);
        if (runningTask) return;
      }

      await fileModel.deleteFileChunks(tx as any, fileIds);
      await tx
        .delete(documents)
        .where(
          and(
            inArray(documents.fileId, fileIds),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents),
            eq(documents.sourceType, 'file'),
          ),
        );
      if (taskIds.length > 0) {
        await tx.delete(asyncTasks).where(inArray(asyncTasks.id, taskIds));
      }

      await tx
        .update(files)
        .set({ ...value, updatedAt: new Date() })
        .where(
          and(
            inArray(files.id, fileIds),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, files),
          ),
        );

      return fileIds[0];
    });
  };
}
