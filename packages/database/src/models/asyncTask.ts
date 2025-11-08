import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@lobechat/types';
import { and, eq, inArray, lt } from 'drizzle-orm';

import { AsyncTaskSelectItem, NewAsyncTaskItem, asyncTasks } from '../schemas';
import { LobeChatDatabase } from '../type';

// set timeout to about 5 minutes, and give 2s padding time
export const ASYNC_TASK_TIMEOUT = 298 * 1000;

export class AsyncTaskModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  create = async (params: Pick<NewAsyncTaskItem, 'type' | 'status'>): Promise<string> => {
    const data = await this.db
      .insert(asyncTasks)
      .values({ ...params, userId: this.userId })
      .returning();

    return data[0].id;
  };

  delete = async (id: string) => {
    return this.db
      .delete(asyncTasks)
      .where(and(eq(asyncTasks.id, id), eq(asyncTasks.userId, this.userId)));
  };

  findById = async (id: string) => {
    return this.db.query.asyncTasks.findFirst({ where: and(eq(asyncTasks.id, id)) });
  };

  update(taskId: string, value: Partial<AsyncTaskSelectItem>) {
    return this.db
      .update(asyncTasks)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(asyncTasks.id, taskId)));
  }

  findByIds = async (taskIds: string[], type: AsyncTaskType): Promise<AsyncTaskSelectItem[]> => {
    let chunkTasks: AsyncTaskSelectItem[] = [];

    if (taskIds.length > 0) {
      await this.checkTimeoutTasks(taskIds);
      chunkTasks = await this.db.query.asyncTasks.findMany({
        where: and(inArray(asyncTasks.id, taskIds), eq(asyncTasks.type, type)),
      });
    }

    return chunkTasks;
  };

  /**
   * make the task status to be `error` if the task is not finished in 20 seconds
   */
  checkTimeoutTasks = async (ids: string[]) => {
    const tasks = await this.db
      .select({ id: asyncTasks.id })
      .from(asyncTasks)
      .where(
        and(
          inArray(asyncTasks.id, ids),
          eq(asyncTasks.status, AsyncTaskStatus.Processing),
          lt(asyncTasks.createdAt, new Date(Date.now() - ASYNC_TASK_TIMEOUT)),
        ),
      );

    if (tasks.length > 0) {
      await this.db
        .update(asyncTasks)
        .set({
          error: new AsyncTaskError(
            AsyncTaskErrorType.Timeout,
            'task is timeout, please try again',
          ),
          status: AsyncTaskStatus.Error,
        })
        .where(
          inArray(
            asyncTasks.id,
            tasks.map((item) => item.id),
          ),
        );
    }
  };
}
