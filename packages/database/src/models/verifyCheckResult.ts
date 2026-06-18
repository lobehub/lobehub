import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import type { NewVerifyCheckResult, VerifyCheckResultItem } from '../schemas/verify';
import { verifyCheckResults } from '../schemas/verify';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export class VerifyCheckResultModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, verifyCheckResults);

  create = async (params: Omit<NewVerifyCheckResult, 'userId' | 'workspaceId'>) => {
    const [result] = await this.db
      .insert(verifyCheckResults)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, params))
      .returning();

    return result;
  };

  /** Batch-insert the initial `pending` rows when verify execution starts. */
  createMany = async (rows: Omit<NewVerifyCheckResult, 'userId' | 'workspaceId'>[]) => {
    if (rows.length === 0) return [];
    return this.db
      .insert(verifyCheckResults)
      .values(
        rows.map((r) =>
          buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, r),
        ),
      )
      .returning();
  };

  findById = async (id: string) => {
    return this.db.query.verifyCheckResults.findFirst({
      where: and(eq(verifyCheckResults.id, id), this.ownership()),
    });
  };

  /** All results for one Agent Run, ordered by display index. */
  listByOperation = async (operationId: string): Promise<VerifyCheckResultItem[]> => {
    return this.db
      .select()
      .from(verifyCheckResults)
      .where(and(eq(verifyCheckResults.operationId, operationId), this.ownership()))
      .orderBy(asc(verifyCheckResults.checkItemIndex));
  };

  update = async (id: string, value: Partial<Omit<VerifyCheckResultItem, 'id' | 'userId'>>) => {
    return this.db
      .update(verifyCheckResults)
      .set(value)
      .where(and(eq(verifyCheckResults.id, id), this.ownership()));
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
          this.ownership(),
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
          this.ownership(),
          inArray(verifyCheckResults.checkItemId, checkItemIds),
          isNull(verifyCheckResults.verifierTracingId),
        ),
      );
  };
}
