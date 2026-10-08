import { TaskTopicModel, TERMINAL_TOPIC_STATUSES } from '../../models/taskTopic';
import type { LobeChatDatabase } from '../../type';

/**
 * The orphaned-run reconciliation's claim on a Task run, as one unit of work.
 *
 * A claim moves the `task_topics` run row out of `running` and stamps the end
 * of the underlying topic. Those are two aggregates, so the pair commits here in
 * one transaction rather than inside {@link TaskTopicModel}: committed
 * separately, a failed stamp would leave the run terminal with the claimer never
 * learning it won, so nothing would hand it back — and the sweep only looks at
 * `running` rows, so that run could never be retried.
 */
export class TaskRunClaimRepo {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private model = (db: LobeChatDatabase) => new TaskTopicModel(db, this.userId, this.workspaceId);

  /**
   * Claim one run while it is still `running` under `operationId`. Returns
   * `false` when a newer operation has replaced it or another writer already
   * settled it.
   */
  claim = async (topicId: string, operationId: string, status: string): Promise<boolean> =>
    this.db.transaction(async (tx) => {
      const model = this.model(tx as LobeChatDatabase);
      if (!(await model.claimRunIfRunning(topicId, operationId, status))) return false;
      if (TERMINAL_TOPIC_STATUSES.has(status)) await model.markTopicEnded(topicId, status);
      return true;
    });

  /**
   * Hand back a run claimed by {@link claim} whose settle failed, so the next
   * sweep retries it. Keyed on the same operation as the claim, so a newer run
   * that took the row over in between is never reopened.
   */
  release = async (topicId: string, operationId: string, fromStatus: string): Promise<boolean> =>
    this.db.transaction(async (tx) => {
      const model = this.model(tx as LobeChatDatabase);
      if (!(await model.reopenRun(topicId, operationId, fromStatus))) return false;
      await model.clearTopicEnded(topicId);
      return true;
    });
}
