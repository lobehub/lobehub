import type { TaskItem } from '@lobechat/types';

import { AcceptanceModel } from '../../models/acceptance';
import { TaskModel } from '../../models/task';
import { WorkModel } from '../../models/work';
import type { LobeChatDatabase } from '../../type';

/** Why a takeover was refused; checked under the subtree lock. */
export class TaskTakeOverError extends Error {
  constructor(readonly reason: 'hidden_subtasks' | 'running') {
    super(
      reason === 'running'
        ? 'Cannot take over this task while it or a subtask is running.'
        : 'Cannot take over this task while it has private subtasks you cannot see.',
    );
    this.name = 'TaskTakeOverError';
  }
}

/**
 * Cross-aggregate write flows over a task subtree. A task's visibility is
 * mirrored onto its Work rows, and its acceptances (verify aggregate) are keyed
 * by the task id without an FK, so changing visibility or deleting a subtree
 * writes several aggregates in one transaction. Each piece stays a
 * single-aggregate Model method; this repository owns the unit of work.
 */
export class TaskSubtreeRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private taskModel = (db: LobeChatDatabase = this.db) =>
    new TaskModel(db, this.userId, this.workspaceId);

  /**
   * Move a task and its full subtree to a new visibility (both directions —
   * the router gates who may call it).
   *
   * Cascades inside a single transaction:
   *   - the root task and every descendant in `tasks`;
   *   - `task_dependencies` and `task_documents` whose `task_id` is in the set;
   *   - the indexed visibility mirror on the tasks' Work rows, so gallery/list
   *     queries cannot observe a stale public row after demotion;
   *   - on demotion, `assignee_user_id` is cleared wherever it names someone
   *     other than the task's creator, who could no longer open the task;
   *   - with `takeOwnership`, the caller becomes the subtree's creator first
   *     and its automation stops (see `takeOverSubtree`).
   *
   * `task_topics` and `task_comments` are direction-sensitive. Their
   * `visibility` column is a write-time mirror of the parent task used as a
   * JOIN-free authorization proxy, so:
   *   - `private → public` deliberately does **not** cascade them: promoting
   *     the task must not retroactively expose runs and discussions that
   *     happened while it was private. Rows created after promotion inherit
   *     the task's then-current visibility through their own create paths.
   *   - `public → private` **does** cascade them: leaving public-era rows
   *     public would let workspace members keep reading/operating historical
   *     topics and comments of a task they can no longer see.
   *
   * Returns `null` if the root task is not visible to the current caller
   * (either missing or owned by another workspace member). Callers should
   * gate authorization (creator-only / admin) before invoking this.
   */
  async updateVisibility(
    id: string,
    visibility: 'private' | 'public',
    options: { takeOwnership?: boolean } = {},
  ): Promise<TaskItem | null> {
    const taskModel = this.taskModel();
    const root = await taskModel.findById(id);
    if (!root) return null;
    if (root.visibility === visibility) return root;

    const descendantIds = (await taskModel.findAllDescendants(root.id)).map((d) => d.id);
    // Taking a task over only applies on the way to private, and only when the
    // subtree is not already the caller's.
    const takeOver =
      !!options.takeOwnership && visibility === 'private' && root.createdByUserId !== this.userId;

    return this.db.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      // Ownership moves first, so the visibility write below already treats
      // the caller as the creator (and unassigns the previous one).
      if (takeOver) {
        const taskIds = [root.id, ...descendantIds];
        const locked = await this.taskModel(db).lockWholeSubtree(root.id);
        // A private subtask the previous creator kept to themselves is not the
        // caller's to take, and leaving it behind would split the subtree.
        const visible = new Set(taskIds);
        if (locked.some((task) => !visible.has(task.id))) {
          throw new TaskTakeOverError('hidden_subtasks');
        }
        // Runs are attributed to the creator; a live one would finish as the
        // previous creator.
        if (locked.some((task) => task.status === 'running')) {
          throw new TaskTakeOverError('running');
        }
        await this.taskModel(db).takeOverSubtree(taskIds);
        await new WorkModel(db, this.userId, this.workspaceId).reassignTaskWorksOwner(
          taskIds,
          root.createdByUserId,
        );
      }
      const updated = await this.taskModel(db).setSubtreeVisibility(
        root.id,
        descendantIds,
        visibility,
      );
      await new WorkModel(db, this.userId, this.workspaceId).setTaskWorksVisibility(
        [root.id, ...descendantIds],
        visibility,
      );
      return updated;
    });
  }

  /** Delete a task, every descendant and their acceptances in one transaction. */
  async deleteSubtree(rootTaskId: string): Promise<number> {
    const descendants = await this.taskModel().findAllDescendants(rootTaskId);
    const taskIds = [rootTaskId, ...descendants.map(({ id }) => id)];

    return this.db.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      await new AcceptanceModel(db, this.userId, this.workspaceId).deleteBySubjects(
        'task',
        taskIds,
      );
      return this.taskModel(db).deleteByIds(taskIds);
    });
  }
}
