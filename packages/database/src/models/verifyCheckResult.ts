import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import type { NewVerifyCheckResult, VerifyCheckResultItem } from '../schemas/verify';
import { verifyCheckResults } from '../schemas/verify';
import type { LobeChatDatabase } from '../type';

export class VerifyCheckResultModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  create = async (params: Omit<NewVerifyCheckResult, 'userId'>) => {
    const [result] = await this.db
      .insert(verifyCheckResults)
      .values({ ...params, userId: this.userId })
      .returning();

    return result;
  };

  /** Batch-insert the initial `pending` rows when verify execution starts. */
  createMany = async (rows: Omit<NewVerifyCheckResult, 'userId'>[]) => {
    if (rows.length === 0) return [];
    return this.db
      .insert(verifyCheckResults)
      .values(rows.map((r) => ({ ...r, userId: this.userId })))
      .returning();
  };

  findById = async (id: string) => {
    return this.db.query.verifyCheckResults.findFirst({
      where: and(eq(verifyCheckResults.id, id), eq(verifyCheckResults.userId, this.userId)),
    });
  };

  /** All results for one Agent Run, ordered by display index. */
  listByOperation = async (operationId: string): Promise<VerifyCheckResultItem[]> => {
    return this.db
      .select()
      .from(verifyCheckResults)
      .where(
        and(
          eq(verifyCheckResults.operationId, operationId),
          eq(verifyCheckResults.userId, this.userId),
        ),
      )
      .orderBy(asc(verifyCheckResults.checkItemIndex));
  };

  update = async (id: string, value: Partial<Omit<VerifyCheckResultItem, 'id' | 'userId'>>) => {
    return this.db
      .update(verifyCheckResults)
      .set(value)
      .where(and(eq(verifyCheckResults.id, id), eq(verifyCheckResults.userId, this.userId)));
  };

  /**
   * Update a result by its stable `(operationId, checkItemId)` key rather than
   * the row id — used by the executor / batch judge which produces verdicts keyed
   * by check item id, never by array position.
   */
  updateByCheckItem = async (
    operationId: string,
    checkItemId: string,
    value: Partial<Omit<VerifyCheckResultItem, 'id' | 'userId'>>,
  ) => {
    return this.db
      .update(verifyCheckResults)
      .set(value)
      .where(
        and(
          eq(verifyCheckResults.operationId, operationId),
          eq(verifyCheckResults.checkItemId, checkItemId),
          eq(verifyCheckResults.userId, this.userId),
        ),
      );
  };

  /**
   * Late-bind the LLM tracing row onto already-written verdicts. The verdict is
   * persisted synchronously with `verifier_tracing_id = null`; the tracing row
   * lands asynchronously (best-effort, after the response), so the FK link is
   * backfilled only once that row exists. Idempotent — only fills `NULL`s and is
   * scoped to the items judged in this call (a batch shares one tracing id).
   */
  backfillTracingId = async (operationId: string, checkItemIds: string[], tracingId: string) => {
    if (checkItemIds.length === 0) return;
    return this.db
      .update(verifyCheckResults)
      .set({ verifierTracingId: tracingId })
      .where(
        and(
          eq(verifyCheckResults.operationId, operationId),
          eq(verifyCheckResults.userId, this.userId),
          inArray(verifyCheckResults.checkItemId, checkItemIds),
          isNull(verifyCheckResults.verifierTracingId),
        ),
      );
  };
}
