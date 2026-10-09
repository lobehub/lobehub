import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import type { LobeChatDatabase } from '@/database/type';

export interface TopicRunLink {
  /**
   * The Task's creator, which is the identity the completion callback reads:
   * `/api/workflows/task/on-topic-complete` derives the workspace from
   * `tasks.createdByUserId = userId`. A workspace member answering someone
   * else's run must hand the owner over — passing the member would make that
   * lookup miss and settle the run in personal scope, where the workspace row
   * is invisible, leaving it stuck `running`.
   */
  ownerUserId: string;
  /** The run row's status, as the Task side last wrote it. */
  runStatus: string;
  taskId: string;
  taskIdentifier: string;
  /**
   * The conversation the row belongs to — the one the user typed into, and the
   * one the reopen is keyed on. A run the server placed on a topic of its own is
   * not a continuation of this row; if that ever happened, the row left behind
   * is settled by the orphaned-run reconciliation like any other lost run.
   */
  topicId: string;
}

/** What reopening a run did, so the caller can tell a no-op from a refusal. */
export type TopicRunReopenOutcome =
  /** The row is this operation's: the run is recorded and live. */
  | 'reopened'
  /** A newer run owns the row. Nothing was written; leave it alone. */
  | 'already-running'
  /** The Task was retired under this send: nothing can be recorded. */
  | 'refused';

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
   * The run this send can own, if any — the whole "is this a Task run?" test for
   * the composer path.
   *
   * `undefined` is the ordinary conversation, which is the common case, plus the
   * two cases where this send must not take the run over:
   *
   * - **the Task is retired** (canceled, or gone): there is no Task-side row to
   *   keep honest, and settling one would resurrect it — a default-config Task
   *   can be moved out of `canceled` by a completion. The message still sends,
   *   as an ordinary turn in the conversation.
   * - **the row is already `running`**: a live run owns it, and a second send is
   *   not a second Task run. Reopening would steal the `operationId` that
   *   cancellation interrupts, and attaching a completion hook would let this
   *   send settle the row while that run is still going.
   */
  async resolveOwnableRun(topicId: string): Promise<TopicRunLink | undefined> {
    const run = await new TaskTopicModel(this.db, this.userId, this.workspaceId).findByTopicId(
      topicId,
    );
    if (!run?.topicId || run.status === 'running') return undefined;

    const task = await new TaskModel(this.db, this.userId, this.workspaceId).findById(run.taskId);
    if (!task || task.status === 'canceled') return undefined;

    return {
      ownerUserId: task.createdByUserId ?? this.userId,
      runStatus: run.status,
      taskId: run.taskId,
      taskIdentifier: task.identifier,
      topicId,
    };
  }

  /**
   * Put the run back in flight, because its topic is live again.
   *
   * The run row and the topic's end stamp are two aggregates, so the pair
   * commits in one transaction — a stamp that failed on its own would leave a
   * live run stamped as ended. That is also why the model method only writes the
   * row and this owns the pair.
   *
   * Runs on the operation-created boundary, *before* the run's first step: a
   * short run can otherwise finish — and have its completion hook settle the
   * row — while the dispatch is still returning, and a reopen after that would
   * rewrite a finished run back to `running` with nothing left to settle it.
   */
  async reopen(params: {
    link: TopicRunLink;
    operationId: string;
  }): Promise<TopicRunReopenOutcome> {
    const { link, operationId } = params;
    const { topicId } = link;

    return this.db.transaction(async (tx) => {
      const taskModel = new TaskModel(tx, link.ownerUserId, this.workspaceId);
      const taskTopicModel = new TaskTopicModel(tx, link.ownerUserId, this.workspaceId);

      // The runner's own lock, for the runner's own reason: a Task deleted or
      // retired while this run was starting has to be observed here rather than
      // have a live run reopened underneath it.
      if (!(await taskModel.lockForUpdate(link.taskId))) return 'refused';

      const task = await taskModel.findById(link.taskId);
      if (!task || task.status === 'canceled') return 'refused';

      if (!(await taskTopicModel.reopenSettledRun(topicId, operationId))) return 'already-running';

      await taskTopicModel.clearTopicEnded(topicId);

      if (task.status !== 'running') {
        await taskModel.updateStatusIfCurrent(link.taskId, task.status, 'running', {
          error: null,
          startedAt: new Date(),
        });
      }

      return 'reopened';
    });
  }
}
