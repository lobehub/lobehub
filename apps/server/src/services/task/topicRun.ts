import { isAgentOperationInFlight } from '@lobechat/types';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { isComposerSupersedableTrigger } from '@/server/services/agentRuntime/foregroundOperation';

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
  /**
   * Set when the row is still `running` under an operation this send replaces:
   * the send takes the row over from it instead of reopening a settled one.
   */
  takeOverOperationId?: string;
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

/** What the send knows about the run it may replace. */
export interface TopicRunSendContext {
  /**
   * Whether someone already asked this run to stop (its interrupt sentinel is
   * set). Such a run ends `interrupted` and never settles its row itself.
   */
  isStopRequested?: (operationId: string) => Promise<boolean>;
  /** The run the client asked this send to replace (`replacesOperationId`). */
  replacesOperationId?: string;
  /**
   * Whether this start retires a live foreground run on the topic, as a person
   * at the composer does. A server-started follow-up waits instead.
   */
  supersedeLiveRun?: boolean;
  /**
   * Set for a send into a thread. A thread start neither replaces nor retires
   * the topic's main run, so it can never take a `running` row over.
   */
  threadId?: string | null;
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
   * - **the row is `running` under a run this send leaves alone**: that run
   *   still owns it, and a second send is not a second Task run. Taking it over
   *   would steal the `operationId` that cancellation interrupts, and attaching
   *   a completion hook would let this send settle the row while that run is
   *   still going.
   *
   * A `running` row is taken over when this send ends the run behind it (see
   * {@link resolveTakeOver}). That is the common shape of a follow-up: the user
   * answers within seconds of the last reply, before the run has settled, and
   * the composer supersedes it. The superseded run ends `interrupted`, which
   * never settles the row — so unless this send takes it over, the Task stays
   * `running` with nothing behind it.
   */
  async resolveOwnableRun(
    topicId: string,
    send: TopicRunSendContext = {},
  ): Promise<TopicRunLink | undefined> {
    const run = await new TaskTopicModel(this.db, this.userId, this.workspaceId).findByTopicId(
      topicId,
    );
    if (!run?.topicId) return undefined;

    let takeOverOperationId: string | undefined;
    if (run.status === 'running') {
      takeOverOperationId = await this.resolveTakeOver(topicId, run.operationId, send);
      if (!takeOverOperationId) return undefined;
    }

    const task = await new TaskModel(this.db, this.userId, this.workspaceId).findById(run.taskId);
    // An archived task is hidden from every list; its topic stays a plain chat.
    if (!task || task.status === 'canceled' || task.archivedAt) return undefined;

    return {
      ownerUserId: task.createdByUserId ?? this.userId,
      runStatus: run.status,
      ...(takeOverOperationId && { takeOverOperationId }),
      taskId: run.taskId,
      taskIdentifier: task.identifier,
      topicId,
    };
  }

  /**
   * The operation a `running` row can be taken over from, if this send ends it
   * — or it has already ended. A thread send ends nothing on the main spine,
   * and is never granted one:
   *
   * - **it is no longer in flight**: interrupted, or ended with its report still
   *   in transit. Nothing will run under it again; its late report, if any, is
   *   ignored once a newer run owns the row (`onTopicComplete`).
   * - **it was already asked to stop**: a queued follow-up sent "now" stops the
   *   run and clears the topic marker before starting, so neither of the two
   *   rules below can see it.
   * - **it is the run this send replaces** (`replacesOperationId`): the start
   *   interrupts it before dispatching. Honored only for the caller's own run on
   *   this topic, the same check the start applies before stopping it.
   * - **it is the topic's live foreground run**, which an interactive send
   *   retires before starting (`supersedeRunningForegroundOperation`): same
   *   conditions — the marker holder, `running`, a supersedable trigger, the
   *   caller's own, and not a device-hosted run.
   *
   * Anything else is a run that keeps going next to this send.
   */
  private async resolveTakeOver(
    topicId: string,
    operationId: string | null,
    send: TopicRunSendContext,
  ): Promise<string | undefined> {
    if (!operationId || send.threadId) return undefined;

    const operation = await new AgentOperationModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).findById(operationId);
    // A missing row proves nothing: a run executed on the client never writes
    // one, and its report could not be told apart from the new run's.
    if (!operation) return undefined;
    if (!isAgentOperationInFlight(operation.status)) return operationId;

    if (operation.topicId !== topicId) return undefined;

    // Already asked to stop — most often by this very send: a queued follow-up
    // sent "now" interrupts the run and clears the topic marker before it
    // starts, so the run still reads `running` but is on its way out.
    if (await this.isStopRequested(send, operationId)) return operationId;

    // Workspace reads are member-wide: a teammate's live run is never ours to end.
    if (operation.userId !== this.userId) return undefined;

    if (send.replacesOperationId === operationId) return operationId;

    if (send.supersedeLiveRun === false || operation.status !== 'running') return undefined;
    if (!isComposerSupersedableTrigger(operation.trigger)) return undefined;

    const topic = await new TopicModel(this.db, this.userId, this.workspaceId).findById(topicId);
    const marker = topic?.metadata?.runningOperation;
    if (marker?.operationId !== operationId || marker.heteroType) return undefined;

    return operationId;
  }

  /** Fails closed: an unreadable sentinel leaves the run with its owner. */
  private async isStopRequested(send: TopicRunSendContext, operationId: string) {
    if (!send.isStopRequested) return false;
    try {
      return await send.isStopRequested(operationId);
    } catch (error) {
      console.error(
        '[TopicRunService] failed to read the interrupt state of %s:',
        operationId,
        error,
      );
      return false;
    }
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

      // Re-checked under the row lock: an archive that committed meanwhile is
      // seen here, and one still pending finds the task running and refuses.
      const task = await taskModel.findById(link.taskId);
      if (!task || task.status === 'canceled' || task.archivedAt) return 'refused';

      // Take the row over from the run this send replaced; if that run settled
      // in the meantime, the row is reopened like any settled one.
      const tookOver =
        !!link.takeOverOperationId &&
        (await taskTopicModel.takeOverRunningRun(topicId, link.takeOverOperationId, operationId));
      if (!tookOver && !(await taskTopicModel.reopenSettledRun(topicId, operationId)))
        return 'already-running';

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
