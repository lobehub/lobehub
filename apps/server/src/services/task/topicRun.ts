import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import type { LobeChatDatabase } from '@/database/type';

export interface TopicRunLink {
  /** The run row's status, as the Task side last wrote it. */
  runStatus: string;
  taskId: string;
  taskIdentifier: string;
}

/**
 * The Task side of a run started in a conversation.
 *
 * Runs normally start in `TaskRunnerService.runTask`, which owns both ends of a
 * Task's bookkeeping: it opens the run row and registers the hook that closes
 * it. A user answering a finished run in that run's own conversation is the
 * second entry point — dispatched from the composer, never through the runner.
 * Left out, it is the one run the Task cannot see: the run card keeps the
 * finished state of the run it replied to, `TaskService.cancelTopic` refuses to
 * stop the live one, and the detail page stops polling for it.
 *
 * Deliberately not a method on `TaskService`, which is the natural home by name
 * but drags the runner, the scheduler and the review services behind it — and
 * the send path this runs on needs two queries, not that graph.
 */
export class TopicRunService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  /**
   * The run this conversation continues, if it is one.
   *
   * `undefined` is the ordinary conversation — by far the common case for a
   * send — so callers use this as the "is this a Task run at all?" test.
   */
  async findByTopicId(topicId: string): Promise<TopicRunLink | undefined> {
    const run = await new TaskTopicModel(this.db, this.userId, this.workspaceId).findByTopicId(
      topicId,
    );
    if (!run?.topicId) return undefined;

    const task = await new TaskModel(this.db, this.userId, this.workspaceId).findById(run.taskId);
    if (!task) return undefined;

    return { runStatus: run.status, taskId: run.taskId, taskIdentifier: task.identifier };
  }

  /**
   * Put the run back in flight, because its topic is live again.
   *
   * The run row and the topic's end stamp are two aggregates, so the pair
   * commits in one transaction — a stamp that failed on its own would leave a
   * live run stamped as ended. That is also why the model method only writes the
   * row and this owns the pair.
   *
   * Best-effort on purpose. The message is already sent and the run is already
   * going, so a Task retired underneath it must not fail the caller's request —
   * there is nothing left to reopen, and nothing to gain by refusing.
   */
  async reopen(params: {
    link: TopicRunLink;
    operationId: string;
    topicId: string;
  }): Promise<boolean> {
    const { link, operationId, topicId } = params;

    return this.db.transaction(async (tx) => {
      const taskModel = new TaskModel(tx, this.userId, this.workspaceId);
      const taskTopicModel = new TaskTopicModel(tx, this.userId, this.workspaceId);

      // The runner's own lock, for the runner's own reason: a Task deleted or
      // retired while this run was starting has to be observed here rather than
      // have a live run reopened underneath it.
      if (!(await taskModel.lockForUpdate(link.taskId))) return false;

      const task = await taskModel.findById(link.taskId);
      if (!task || task.status === 'canceled') return false;

      // A miss is a real answer rather than a no-op: the row is already
      // `running`, so this message joined the run in flight and that run's
      // operation id must stay the one cancellation interrupts.
      if (!(await taskTopicModel.reopenSettledRun(topicId, operationId))) return false;

      await taskTopicModel.clearTopicEnded(topicId);

      if (task.status !== 'running') {
        await taskModel.updateStatusIfCurrent(link.taskId, task.status, 'running', {
          error: null,
          startedAt: new Date(),
        });
      }

      return true;
    });
  }
}
