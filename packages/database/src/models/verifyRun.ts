import type { VerifyCheckItem, VerifyRunSource, VerifyRunStatus } from '@lobechat/types';
import { and, desc, eq, ilike, isNull, lt, or, sql } from 'drizzle-orm';

import { agentOperations } from '../schemas/agentOperations';
import type { NewVerifyRun, VerifyRunItem } from '../schemas/verify';
import { verifyRuns } from '../schemas/verify';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

/**
 * Shape returned by the *State helpers — kept field-compatible with the legacy
 * `AgentOperationModel.getVerifyState` return (verifyPlan / verifyPlanConfirmedAt
 * / verifyStatus) so the router response and every UI / CLI consumer stay
 * unchanged while the storage moves from agent_operations to verify_runs.
 */
export interface VerifyRunState {
  verifyPlan: VerifyCheckItem[] | null;
  verifyPlanConfirmedAt: Date | null;
  /** The session id — exposed so a builder holding only its operationId can
   * resolve the handle needed by `verify.submitCheckEvidence` before any
   * result rows exist (the run-start gap). */
  verifyRunId: string | null;
  verifyStatus: VerifyRunStatus | null;
}

/**
 * Opaque list cursor = `${createdAt ISO}__${id}`. Both parts are metacharacter-
 * free (ISO timestamp + uuid), so a plain `__` delimiter round-trips safely.
 */
const encodeCursor = (createdAt: Date, id: string): string => `${createdAt.toISOString()}__${id}`;

const decodeCursor = (cursor?: string): { createdAt: Date; id: string } | null => {
  if (!cursor) return null;
  const idx = cursor.lastIndexOf('__');
  if (idx <= 0) return null;
  const createdAt = new Date(cursor.slice(0, idx));
  const id = cursor.slice(idx + 2);
  if (Number.isNaN(createdAt.getTime()) || !id) return null;
  return { createdAt, id };
};

/** Escape LIKE/ILIKE metacharacters (`\ % _`) so user input matches literally. */
const escapeLike = (value: string): string => value.replaceAll(/[\\%_]/g, (c) => `\\${c}`);

const toState = (run: VerifyRunItem | null | undefined): VerifyRunState | null =>
  run
    ? {
        verifyPlan: (run.plan ?? null) as VerifyCheckItem[] | null,
        verifyPlanConfirmedAt: run.planConfirmedAt ?? null,
        verifyRunId: run.id,
        verifyStatus: (run.status ?? null) as VerifyRunStatus | null,
      }
    : null;

/**
 * Owns the verification-session entity (`verify_runs`): the plan snapshot, the
 * rollup status, and the optional link to an Agent Run. The verify pipeline
 * addresses sessions by `operationId` for agent runs (resolved here via
 * {@link ensureForOperation} / {@link findByOperation}); standalone sessions
 * (e.g. agent-testing ingest) are created directly with no operation.
 */
export class VerifyRunModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, verifyRuns);

  /**
   * Guard before reserving the (globally-unique) `operation_id` on a new run.
   *
   * A verify_run stamps the *current* caller's ownership, but `operation_id` is
   * unique across the whole table — so reserving one for an Agent Run that isn't
   * ours would (a) mis-attribute that operation's session to the wrong owner and
   * (b) lock the real owner out: their later insert hits the unique conflict and
   * the ownership-scoped re-read filters the stolen row away, yielding no run.
   * Confirm the operation is actually owned by this user/workspace first.
   */
  private assertOperationOwned = async (operationId: string): Promise<void> => {
    const [op] = await this.db
      .select({ id: agentOperations.id })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.id, operationId),
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            agentOperations,
          ),
        ),
      )
      .limit(1);
    if (!op) {
      throw new Error(`Agent operation "${operationId}" not found in the current workspace`);
    }
  };

  create = async (
    params: Omit<NewVerifyRun, 'userId' | 'workspaceId'> & { source?: VerifyRunSource },
  ): Promise<VerifyRunItem> => {
    // A caller-supplied operation link must belong to this owner before we
    // reserve its unique operation_id (see {@link assertOperationOwned}).
    if (params.operationId) await this.assertOperationOwned(params.operationId);

    const [run] = await this.db
      .insert(verifyRuns)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, params))
      .returning();
    return run;
  };

  findById = async (id: string) => {
    return this.db.query.verifyRuns.findFirst({
      where: and(eq(verifyRuns.id, id), this.ownership()),
    });
  };

  /** Recent verification sessions for the current user/workspace, newest first. */
  query = async (limit = 50) => {
    return this.db.query.verifyRuns.findMany({
      limit,
      orderBy: [desc(verifyRuns.createdAt)],
      where: this.ownership(),
    });
  };

  /**
   * Cursor-paginated page of verification sessions, newest first, optionally
   * filtered by a title search. Ordered by `(createdAt, id)` descending and
   * paged on that composite key so rows sharing a `createdAt` (e.g. a batch
   * ingest) can't be dropped or duplicated at a page boundary — a plain
   * `createdAt`-only cursor would.
   *
   * `createdAt` is compared/ordered at **millisecond** precision
   * (`date_trunc('milliseconds', …)`) to match the cursor, which round-trips
   * through a JS `Date` / ISO string and so only carries milliseconds. The DB
   * column is `timestamptz` and can hold microseconds; comparing the raw column
   * against the truncated cursor would make same-millisecond rows match neither
   * the `eq` tiebreaker nor the `lt` bound, silently dropping them. Truncating
   * both sides keeps the keyset lossless.
   *
   * Fetches `limit + 1` to detect a further page without a second COUNT query:
   * `nextCursor` is `null` on the last page, otherwise the encoded cursor of the
   * last returned row.
   */
  queryPage = async ({
    cursor,
    limit = 30,
    q,
  }: { cursor?: string; limit?: number; q?: string } = {}): Promise<{
    items: VerifyRunItem[];
    nextCursor: string | null;
  }> => {
    const conditions = [this.ownership()];

    // Millisecond-truncated createdAt — the precision the cursor round-trips at.
    const createdAtMs = sql`date_trunc('milliseconds', ${verifyRuns.createdAt})`;

    const decoded = decodeCursor(cursor);
    if (decoded) {
      // (createdAt, id) < (cursor.createdAt, cursor.id) in descending order.
      conditions.push(
        or(
          lt(createdAtMs, decoded.createdAt),
          and(eq(createdAtMs, decoded.createdAt), lt(verifyRuns.id, decoded.id)),
        )!,
      );
    }

    const search = q?.trim();
    // Escape LIKE metacharacters so a user typing `%`/`_` searches literally.
    if (search) conditions.push(ilike(verifyRuns.title, `%${escapeLike(search)}%`));

    const rows = await this.db.query.verifyRuns.findMany({
      limit: limit + 1,
      orderBy: [desc(createdAtMs), desc(verifyRuns.id)],
      where: and(...conditions),
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

    return { items, nextCursor };
  };

  /** The verification session bound to an Agent Run, or undefined when none yet. */
  findByOperation = async (operationId: string) => {
    return this.db.query.verifyRuns.findFirst({
      where: and(eq(verifyRuns.operationId, operationId), this.ownership()),
    });
  };

  /**
   * Get (or lazily create) the verification session for an Agent Run. Upserts on
   * the `operation_id` unique index so concurrent callers converge on one row.
   */
  ensureForOperation = async (
    operationId: string,
    defaults?: Partial<Pick<NewVerifyRun, 'goal' | 'title'>>,
  ): Promise<VerifyRunItem> => {
    const existing = await this.findByOperation(operationId);
    if (existing) return existing;

    // No run yet for an operation we can see — but `findByOperation` is scoped to
    // our ownership, so a row could exist under another owner. Verify the
    // operation is ours before reserving its unique operation_id.
    await this.assertOperationOwned(operationId);

    await this.db
      .insert(verifyRuns)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { operationId, source: 'agent' as const, ...defaults },
        ),
      )
      .onConflictDoNothing({ target: verifyRuns.operationId });

    // Re-read so concurrent winners and this caller both return the canonical row.
    return (await this.findByOperation(operationId))!;
  };

  /**
   * Write a draft check plan onto the session and flip the rollup to `planned`.
   * The plan is mutable while a draft; it is frozen on {@link confirmPlan}.
   */
  setPlan = async (runId: string, items: VerifyCheckItem[]): Promise<void> => {
    await this.db
      .update(verifyRuns)
      .set({ plan: items, status: 'planned' })
      .where(and(eq(verifyRuns.id, runId), this.ownership()));
  };

  /** Replace the draft plan items (user edited the plan before confirming). */
  replacePlanItems = async (runId: string, items: VerifyCheckItem[]): Promise<void> => {
    await this.db
      .update(verifyRuns)
      .set({ plan: items })
      .where(
        and(
          eq(verifyRuns.id, runId),
          // only a not-yet-confirmed plan may be edited
          isNull(verifyRuns.planConfirmedAt),
          this.ownership(),
        ),
      );
  };

  /** Freeze the plan (records confirmation time). Results relate to frozen items. */
  confirmPlan = async (runId: string, confirmedAt: Date = new Date()): Promise<void> => {
    await this.db
      .update(verifyRuns)
      .set({ planConfirmedAt: confirmedAt })
      .where(and(eq(verifyRuns.id, runId), this.ownership()));
  };

  /**
   * Replace the session's generic policy/extension bag (`metadata`). Used to
   * stamp per-run knobs like the task's `maxRepairRounds` override, and to carry
   * them onto a repair round's run so it derives the same cap.
   */
  setMetadata = async (runId: string, metadata: Record<string, unknown>): Promise<void> => {
    await this.db
      .update(verifyRuns)
      .set({ metadata })
      .where(and(eq(verifyRuns.id, runId), this.ownership()));
  };

  /** Update the denormalized rollup. Always go through the service-layer chokepoint. */
  updateStatus = async (runId: string, status: VerifyRunStatus | null): Promise<void> => {
    await this.db
      .update(verifyRuns)
      .set({ status })
      .where(and(eq(verifyRuns.id, runId), this.ownership()));
  };

  update = async (
    runId: string,
    value: Partial<Pick<NewVerifyRun, 'context' | 'goal' | 'scenario' | 'title'>>,
  ): Promise<VerifyRunItem | undefined> => {
    const [run] = await this.db
      .update(verifyRuns)
      .set(value)
      .where(and(eq(verifyRuns.id, runId), this.ownership()))
      .returning();

    return run;
  };

  /** Read just the verify-related fields for a session (legacy state shape). */
  getState = async (runId: string): Promise<VerifyRunState | null> => {
    const run = await this.findById(runId);
    return toState(run);
  };

  /** Same as {@link getState} but addressed by the bound Agent Run. */
  getStateByOperation = async (operationId: string): Promise<VerifyRunState | null> => {
    const run = await this.findByOperation(operationId);
    return toState(run);
  };

  delete = async (id: string) => {
    return this.db.delete(verifyRuns).where(and(eq(verifyRuns.id, id), this.ownership()));
  };
}
