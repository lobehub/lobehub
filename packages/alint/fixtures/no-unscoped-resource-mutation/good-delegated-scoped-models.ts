// Fixture: a repository that only orchestrates model calls built with its own principal;
// there is no direct mutation in this file.
import { AcceptanceModel, type Database, TaskModel } from './schema';

/** Cross-aggregate write flows over a task subtree; each piece is a scoped Model method. */
export class TaskSubtreeRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private taskModel = (db: Database = this.db) => new TaskModel(db, this.userId, this.workspaceId);

  /** Delete a task, every descendant and their acceptances in one transaction. */
  async deleteSubtree(rootTaskId: string): Promise<number> {
    const descendants = await this.taskModel().findAllDescendants(rootTaskId);
    const taskIds = [rootTaskId, ...descendants.map(({ id }) => id)];

    return this.db.transaction(async (tx) => {
      const db = tx as Database;
      await new AcceptanceModel(db, this.userId, this.workspaceId).deleteBySubjects(
        'task',
        taskIds,
      );
      return this.taskModel(db).deleteByIds(taskIds);
    });
  }
}
