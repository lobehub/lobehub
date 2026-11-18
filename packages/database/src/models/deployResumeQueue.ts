import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';

import type {
  DeployResumePayload,
  DeployResumeQueueItem,
  NewDeployResumeQueueItem,
} from '../schemas/deployResumeQueue';
import { deployResumeQueue } from '../schemas/deployResumeQueue';
import type { LobeChatDatabase } from '../type';

/**
 * Access to the deploy resume queue — the list `scripts/deploy-custom-image.sh`
 * fills right before it settles interrupted runs.
 *
 * Deliberately owner-free: the queue is drained by the server at boot, before
 * any request context exists, so every read here is global. Scoping is carried
 * by `user_id` / `workspace_id` columns that the resumer feeds into the
 * per-user services it calls.
 */
export class DeployResumeQueueModel {
  /**
   * Write (or re-arm) rows for conversations a deploy is about to interrupt.
   *
   * The unique index on `topic_id` makes this idempotent: the deploy script may
   * run twice for the same topic, and the second write refreshes the row back
   * to `pending` instead of queueing the conversation twice.
   */
  static async enqueue(db: LobeChatDatabase, items: NewDeployResumeQueueItem[]): Promise<string[]> {
    if (items.length === 0) return [];

    const rows = await db
      .insert(deployResumeQueue)
      .values(items)
      .onConflictDoUpdate({
        set: {
          attempts: 0,
          error: null,
          kind: sql`excluded.kind`,
          operationId: sql`excluded.operation_id`,
          payload: sql`excluded.payload`,
          resumedAt: null,
          status: 'pending',
          taskId: sql`excluded.task_id`,
          updatedAt: new Date(),
          userId: sql`excluded.user_id`,
          workspaceId: sql`excluded.workspace_id`,
        },
        target: deployResumeQueue.topicId,
      })
      .returning({ id: deployResumeQueue.id });

    return rows.map((row) => row.id);
  }

  /** Pending rows, oldest first — the resumer's only listing query. */
  static async listPending(
    db: LobeChatDatabase,
    options: { limit?: number } = {},
  ): Promise<DeployResumeQueueItem[]> {
    return (await db
      .select()
      .from(deployResumeQueue)
      .where(eq(deployResumeQueue.status, 'pending'))
      .orderBy(asc(deployResumeQueue.createdAt))
      .limit(options.limit ?? 20)) as DeployResumeQueueItem[];
  }

  /**
   * Move one row `pending` → `running` and count the attempt.
   *
   * Returns the row when this caller won the claim and `undefined` when another
   * boot already took it — which is how two containers racing on the same queue
   * end up dispatching each conversation exactly once.
   */
  static async claim(db: LobeChatDatabase, id: string): Promise<DeployResumeQueueItem | undefined> {
    const [claimed] = await db
      .update(deployResumeQueue)
      .set({ attempts: sql`${deployResumeQueue.attempts} + 1`, status: 'running' })
      .where(and(eq(deployResumeQueue.id, id), eq(deployResumeQueue.status, 'pending')))
      .returning();

    return claimed as DeployResumeQueueItem | undefined;
  }

  /**
   * Put a claimed row back to `pending` after a retryable failure, so a later
   * boot (or the same boot's retry loop) picks it up again.
   */
  static async release(db: LobeChatDatabase, id: string, error: string): Promise<void> {
    await db
      .update(deployResumeQueue)
      .set({ error, status: 'pending' })
      .where(eq(deployResumeQueue.id, id));
  }

  /** Close a claimed row with a terminal status. */
  static async finish(
    db: LobeChatDatabase,
    id: string,
    status: 'done' | 'failed' | 'skipped',
    options: { error?: string | null; payload?: DeployResumePayload | null } = {},
  ): Promise<void> {
    await db
      .update(deployResumeQueue)
      .set({
        error: options.error ?? null,
        ...(options.payload && { payload: options.payload }),
        resumedAt: new Date(),
        status,
      })
      .where(eq(deployResumeQueue.id, id));
  }

  /**
   * Close every still-open row created before `staleBefore` as `skipped`.
   *
   * A row older than the staleness window means the container was down for a
   * long time: replaying that turn now would land in a conversation the user
   * has long moved past, so it is dropped instead of re-run.
   */
  static async skipStale(db: LobeChatDatabase, staleBefore: Date): Promise<number> {
    const rows = await db
      .update(deployResumeQueue)
      .set({ error: 'stale', resumedAt: new Date(), status: 'skipped' })
      .where(
        and(
          inArray(deployResumeQueue.status, ['pending', 'running']),
          lt(deployResumeQueue.createdAt, staleBefore),
        ),
      )
      .returning({ id: deployResumeQueue.id });

    return rows.length;
  }

  /** Look one row up by topic — used by tests and by diagnostics. */
  static async findByTopicId(
    db: LobeChatDatabase,
    topicId: string,
  ): Promise<DeployResumeQueueItem | undefined> {
    const [row] = await db
      .select()
      .from(deployResumeQueue)
      .where(eq(deployResumeQueue.topicId, topicId))
      .limit(1);

    return row as DeployResumeQueueItem | undefined;
  }
}
