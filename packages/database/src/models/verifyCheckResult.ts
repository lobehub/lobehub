import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import type { NewVerifyCheckResult, VerifyCheckResultItem } from '../schemas/verify';
import { verifyCheckResults, verifyRuns } from '../schemas/verify';
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

  private runOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, verifyRuns);

  private assertRunOwned = async (verifyRunId: string): Promise<void> => {
    const [run] = await this.db
      .select({ id: verifyRuns.id })
      .from(verifyRuns)
      .where(and(eq(verifyRuns.id, verifyRunId), this.runOwnership()))
      .limit(1);

    if (!run) {
      throw new Error(`Verify run "${verifyRunId}" not found in the current workspace`);
    }
  };

  create = async (params: Omit<NewVerifyCheckResult, 'userId' | 'workspaceId'>) => {
    if (typeof params.verifyRunId === 'string') await this.assertRunOwned(params.verifyRunId);

    const [result] = await this.db
      .insert(verifyCheckResults)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, params))
      .returning();

    return result;
  };

  /** Batch-insert the initial `pending` rows when verify execution starts. */
  createMany = async (rows: Omit<NewVerifyCheckResult, 'userId' | 'workspaceId'>[]) => {
    if (rows.length === 0) return [];
    const verifyRunIds = [
      ...new Set(
        rows.map((r) => r.verifyRunId).filter((id): id is string => typeof id === 'string'),
      ),
    ];
    await Promise.all(verifyRunIds.map((verifyRunId) => this.assertRunOwned(verifyRunId)));

    return this.db
      .insert(verifyCheckResults)
      .values(
        rows.map((r) =>
          buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, r),
        ),
      )
      .returning();
  };

  /**
   * Insert-or-update a result by its stable `(verifyRunId, checkItemId)` key.
   * Used by the ingest path (e.g. agent-testing) which supplies a verdict for a
   * check directly rather than running a verifier. Idempotent — re-ingesting the
   * same check overwrites in place via the unique index.
   */
  upsertByCheckItem = async (
    params: Omit<NewVerifyCheckResult, 'userId' | 'workspaceId'> & {
      checkItemId: string;
      verifyRunId: string;
    },
  ): Promise<VerifyCheckResultItem> => {
    await this.assertRunOwned(params.verifyRunId);

    const values = buildWorkspacePayload(
      { userId: this.userId, workspaceId: this.workspaceId },
      params,
    );
    // The conflict target and ownership keys identify the row, so they're excluded from the set.
    const { verifyRunId: _r, checkItemId: _c, userId: _u, workspaceId: _w, ...mutable } = values;

    const [row] = await this.db
      .insert(verifyCheckResults)
      .values(values)
      .onConflictDoUpdate({
        set: mutable,
        setWhere: this.ownership(),
        target: [verifyCheckResults.verifyRunId, verifyCheckResults.checkItemId],
      })
      .returning();

    if (!row) {
      throw new Error(
        `Verify check result "${params.checkItemId}" not found in the current workspace`,
      );
    }

    return row;
  };

  findById = async (id: string) => {
    return this.db.query.verifyCheckResults.findFirst({
      where: and(eq(verifyCheckResults.id, id), this.ownership()),
    });
  };

  /** All results for one verification session, ordered by display index. */
  listByRun = async (verifyRunId: string): Promise<VerifyCheckResultItem[]> => {
    return this.db
      .select()
      .from(verifyCheckResults)
      .where(and(eq(verifyCheckResults.verifyRunId, verifyRunId), this.ownership()))
      .orderBy(asc(verifyCheckResults.checkItemIndex));
  };

  update = async (id: string, value: Partial<Omit<VerifyCheckResultItem, 'id' | 'userId'>>) => {
    return this.db
      .update(verifyCheckResults)
      .set(value)
      .where(and(eq(verifyCheckResults.id, id), this.ownership()));
  };

  /**
   * Update a result by its stable `(verifyRunId, checkItemId)` key rather than
   * the row id — used by the executor / batch judge which produces verdicts keyed
   * by check item id, never by array position.
   */
  updateByCheckItem = async (
    verifyRunId: string,
    checkItemId: string,
    value: Partial<Omit<VerifyCheckResultItem, 'id' | 'userId'>>,
  ) => {
    return this.db
      .update(verifyCheckResults)
      .set(value)
      .where(
        and(
          eq(verifyCheckResults.verifyRunId, verifyRunId),
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
  backfillTracingId = async (verifyRunId: string, checkItemIds: string[], tracingId: string) => {
    if (checkItemIds.length === 0) return;
    return this.db
      .update(verifyCheckResults)
      .set({ verifierTracingId: tracingId })
      .where(
        and(
          eq(verifyCheckResults.verifyRunId, verifyRunId),
          this.ownership(),
          inArray(verifyCheckResults.checkItemId, checkItemIds),
          isNull(verifyCheckResults.verifierTracingId),
        ),
      );
  };
}
