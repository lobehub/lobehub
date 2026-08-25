import type { VerifyVisibility } from '@lobechat/const/verify';
import type {
  VerifyCheckItem,
  VerifyRunDecisionDetail,
  VerifyRunGroupFeedbackEntry,
  VerifyRunSource,
  VerifyRunStatus,
} from '@lobechat/types';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm';

import { agentOperations } from '../schemas/agentOperations';
import type { NewVerifyRun, VerifyRunItem } from '../schemas/verify';
import { verifyCheckResults, verifyRuns } from '../schemas/verify';
import type { LobeChatDatabase } from '../type';
import { isUuid } from '../utils/uuid';
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
      .select({ id: agentOperations.id, userId: agentOperations.userId })
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
    // Workspace visibility is not enough: the lazily-created run is stamped
    // with the caller's userId and reserves the unique operation_id, which
    // would block the operation's real owner from managing their own run.
    if (op.userId !== this.userId) {
      throw new Error(
        `Agent operation "${operationId}" belongs to another member; only its creator can start a verify run`,
      );
    }
  };

  /**
   * Scope-dependent visibility default: personal rounds are link-shareable
   * (`public`), workspace rounds stay member-gated (`private`). An explicit
   * caller value always wins.
   */
  private defaultVisibility = () => (this.workspaceId ? ('private' as const) : ('public' as const));

  create = async (
    params: Omit<NewVerifyRun, 'userId' | 'workspaceId'> & { source?: VerifyRunSource },
  ): Promise<VerifyRunItem> => {
    // A caller-supplied operation link must belong to this owner before we
    // reserve its unique operation_id (see {@link assertOperationOwned}).
    if (params.operationId) await this.assertOperationOwned(params.operationId);

    const [run] = await this.db
      .insert(verifyRuns)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { visibility: this.defaultVisibility(), ...params },
        ),
      )
      .returning();
    return run;
  };

  findById = async (id: string) => {
    // A malformed id (e.g. an autolinker glued trailing punctuation onto a
    // shared link) would abort the query with 22P02 — read it as "not found".
    if (!isUuid(id)) return undefined;
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

  /**
   * The verification bound to each of several Agent Runs, keyed by operation.
   * Feeds the task's activity list, where every run row needs to answer "and
   * did it pass?" without one query per row.
   */
  findByOperations = async (
    operationIds: string[],
  ): Promise<
    Map<
      string,
      Pick<VerifyRunItem, 'acceptanceId' | 'id' | 'roundIndex' | 'status'> & {
        passed: number;
        total: number;
      }
    >
  > => {
    const ids = [...new Set(operationIds.filter(Boolean))];
    if (ids.length === 0) return new Map();

    // Counts come from the same statement: a run row alone says pass/fail, but
    // "4/4" is what makes a verdict inspectable at a glance, and fetching it
    // per row would be one query per round.
    const rows = await this.db
      .select({
        acceptanceId: verifyRuns.acceptanceId,
        id: verifyRuns.id,
        operationId: verifyRuns.operationId,
        passed: sql<number>`count(*) filter (where ${verifyCheckResults.verdict} = 'passed')`,
        roundIndex: verifyRuns.roundIndex,
        status: verifyRuns.status,
        total: sql<number>`count(${verifyCheckResults.id})`,
      })
      .from(verifyRuns)
      .leftJoin(verifyCheckResults, eq(verifyCheckResults.verifyRunId, verifyRuns.id))
      .where(and(inArray(verifyRuns.operationId, ids), this.ownership()))
      .groupBy(
        verifyRuns.id,
        verifyRuns.acceptanceId,
        verifyRuns.operationId,
        verifyRuns.roundIndex,
        verifyRuns.status,
      );

    return new Map(
      rows
        .filter((row): row is typeof row & { operationId: string } => Boolean(row.operationId))
        .map(({ operationId, passed, total, ...run }) => [
          operationId,
          { ...run, passed: Number(passed), total: Number(total) },
        ]),
    );
  };

  /** Every round chained onto an acceptance aggregate, in round order. */
  listByAcceptance = async (acceptanceId: string): Promise<VerifyRunItem[]> => {
    return this.db.query.verifyRuns.findMany({
      orderBy: [asc(verifyRuns.roundIndex)],
      where: and(eq(verifyRuns.acceptanceId, acceptanceId), this.ownership()),
    });
  };

  /**
   * Chain a run onto an acceptance as its next round. The round index is
   * assigned inside the UPDATE from the chain's current max, so two concurrent
   * attaches cannot read the same max; if they still collide, the
   * `(acceptance_id, round_index)` unique index rejects the loser.
   */
  attachToAcceptance = async (
    runId: string,
    acceptanceId: string,
    /** The aggregate's visibility — attached rounds inherit their umbrella. */
    visibility?: VerifyVisibility,
  ): Promise<VerifyRunItem> => {
    const [run] = await this.db
      .update(verifyRuns)
      .set({
        acceptanceId,
        roundIndex: sql`(
          SELECT COALESCE(MAX(${verifyRuns.roundIndex}), 0) + 1
          FROM ${verifyRuns}
          WHERE ${verifyRuns.acceptanceId} = ${acceptanceId}
        )`,
        ...(visibility ? { visibility } : {}),
      })
      .where(and(eq(verifyRuns.id, runId), this.ownership()))
      .returning();

    if (!run) throw new Error(`Verify run "${runId}" not found in the current workspace`);
    return run;
  };

  /** Flip who can read this round's report page beyond its creator. */
  setVisibility = async (runId: string, visibility: VerifyVisibility): Promise<void> => {
    await this.db
      .update(verifyRuns)
      .set({ visibility })
      .where(and(eq(verifyRuns.id, runId), this.ownership()));
  };

  /**
   * Re-stamp every round chained to an acceptance — the aggregate-level
   * `setVisibility` cascades so rounds never stay more open than (or hidden
   * inside) their umbrella. Deliberately clobbers per-round overrides.
   */
  setVisibilityByAcceptance = async (
    acceptanceId: string,
    visibility: VerifyVisibility,
  ): Promise<void> => {
    await this.db
      .update(verifyRuns)
      .set({ visibility })
      .where(and(eq(verifyRuns.acceptanceId, acceptanceId), this.ownership()));
  };

  /**
   * Record the user's acceptance decision on THIS round (the human verdict that
   * closes or re-opens the acceptance loop). Free-form verb by design — see the
   * `user_decision` column comment.
   */
  /**
   * Append one group-scoped feedback entry to this round's decision detail.
   * Read-merge-write on the jsonb bag; the round carries its feedback (and
   * takes it along when the round is deleted).
   */
  appendGroupFeedback = async (
    runId: string,
    entry: VerifyRunGroupFeedbackEntry,
  ): Promise<VerifyRunDecisionDetail> => {
    const run = await this.db.query.verifyRuns.findFirst({
      where: and(eq(verifyRuns.id, runId), this.ownership()),
    });
    if (!run) throw new Error(`Verify run "${runId}" not found in the current workspace`);

    const decisionDetail: VerifyRunDecisionDetail = {
      ...run.decisionDetail,
      groupFeedback: [...(run.decisionDetail?.groupFeedback ?? []), entry],
    };
    await this.db
      .update(verifyRuns)
      .set({ decisionDetail })
      .where(and(eq(verifyRuns.id, runId), this.ownership()));
    return decisionDetail;
  };

  setDecision = async (
    runId: string,
    userDecision: string,
    decisionDetail?: VerifyRunDecisionDetail,
  ): Promise<void> => {
    await this.db
      .update(verifyRuns)
      .set({ decisionDetail, userDecision })
      .where(and(eq(verifyRuns.id, runId), this.ownership()));
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
  /**
   * Claim the right to drive the task from this run, exactly once.
   *
   * The settle path reads `taskDrivenAt`, decides, and only then writes it —
   * so two verifier callbacks landing together can both pass the read and both
   * act (spawning two rounds, or one spawning while the other pauses the task
   * it just started). The claim moves that decision into a single conditional
   * UPDATE: the row is only stamped if nobody stamped it, and the loser learns
   * it lost from the empty result.
   *
   * @returns true when this caller owns the drive, false when it was taken.
   */
  claimTaskDrive = async (runId: string): Promise<boolean> => {
    const claimed = await this.db
      .update(verifyRuns)
      .set({
        metadata: sql`coalesce(${verifyRuns.metadata}, '{}'::jsonb) || jsonb_build_object('taskDrivenAt', ${new Date().toISOString()}::text)`,
      })
      .where(
        and(
          eq(verifyRuns.id, runId),
          // Null-testing a jsonb arrow expression in a WHERE clause takes the
          // production engine down (XX000), so compare an extracted value
          // against a sentinel instead — see the jsonbNullTest guard.
          sql`coalesce(${verifyRuns.metadata} ->> 'taskDrivenAt', '') = ''`,
          this.ownership(),
        ),
      )
      .returning({ id: verifyRuns.id });

    return claimed.length > 0;
  };

  setMetadata = async (runId: string, metadata: Record<string, unknown>): Promise<void> => {
    await this.db
      .update(verifyRuns)
      .set({ metadata })
      .where(and(eq(verifyRuns.id, runId), this.ownership()));
  };

  /**
   * Claim the right to run the completion-time verify gate on this run, and
   * flip it to `verifying` in the same statement. Always go through the
   * service-layer chokepoint ({@link VerifyStatusService.claimVerifying}).
   *
   * The gate used to be a plain `status === 'planned'` read followed by a
   * separate `verifying` write, which failed in two directions at once: two
   * completions landing together (a queue redelivery of the terminal step) could
   * both pass the read, and an attempt that flipped the run and then died left
   * the gate permanently shut — no later attempt could re-enter, so the rollup
   * was never finished and the run stayed `verifying` forever.
   *
   * One conditional UPDATE answers both: exactly one caller wins, and a
   * `verifying` run untouched since `staleBefore` is read as abandoned and
   * handed to the new caller.
   *
   * @returns true when this caller owns the verification.
   */
  claimVerifying = async (runId: string, staleBefore: Date): Promise<boolean> => {
    const claimed = await this.db
      .update(verifyRuns)
      .set({ status: 'verifying' })
      .where(
        and(
          eq(verifyRuns.id, runId),
          or(
            or(eq(verifyRuns.status, 'planned'), eq(verifyRuns.status, 'collecting_evidence')),
            and(eq(verifyRuns.status, 'verifying'), lt(verifyRuns.updatedAt, staleBefore)),
          ),
          this.ownership(),
        ),
      )
      .returning({ id: verifyRuns.id });

    return claimed.length > 0;
  };

  /** Atomically reserve the builder-owned evidence-submission phase. */
  claimEvidenceCollection = async (runId: string): Promise<boolean> => {
    const claimed = await this.db
      .update(verifyRuns)
      .set({ status: 'collecting_evidence' })
      .where(and(eq(verifyRuns.id, runId), eq(verifyRuns.status, 'planned'), this.ownership()))
      .returning({ id: verifyRuns.id });

    return claimed.length > 0;
  };

  /**
   * One page of runs stranded in `verifying` since before `olderThan`, across
   * all owners — the sweep's input (see `sweepStuckVerifyRuns`).
   *
   * No per-user scope, like `TaskModel.findStuckTasks`: this backs a global
   * cron, and each row carries the owner the recovery is then performed as.
   * Operation-less rounds are excluded — the rollup is addressed by operation,
   * so there is nothing to recompute for them.
   *
   * Paged on the `(updatedAt, id)` keyset rather than returning a fixed oldest-N
   * slice. The sweep deliberately leaves some rows untouched (a check whose
   * verifier is still live), and an untouched row keeps its timestamp — so a
   * single oldest-N read would hand back the same unrecoverable rows every tick
   * and starve every newer stranded run behind them. `id` breaks ties so rows
   * sharing a timestamp can't be skipped or repeated at a page boundary.
   *
   * `updatedAt` is compared/ordered at **millisecond** precision, for the same
   * reason {@link queryPage} does it: the cursor is read back off a row as a JS
   * `Date` and so carries only milliseconds, while the column is `timestamptz`
   * and holds microseconds. Comparing the raw column against the truncated
   * cursor makes a row with a sub-millisecond remainder satisfy its own
   * `>` bound — it is returned again on the next page, the cursor never gets
   * past it, and the scan spins on that row instead of reaching the ones behind
   * it. Truncating both sides keeps the keyset lossless.
   */
  static findStuckVerifying = async (
    db: LobeChatDatabase,
    olderThan: Date,
    options?: { after?: { id: string; updatedAt: Date }; limit?: number },
  ): Promise<VerifyRunItem[]> => {
    const { after, limit = 200 } = options ?? {};

    // Millisecond-truncated updatedAt — the precision the cursor round-trips at.
    const updatedAtMs = sql`date_trunc('milliseconds', ${verifyRuns.updatedAt})`;

    const conditions = [
      eq(verifyRuns.status, 'verifying'),
      lt(verifyRuns.updatedAt, olderThan),
      isNotNull(verifyRuns.operationId),
    ];

    if (after) {
      conditions.push(
        or(
          gt(updatedAtMs, after.updatedAt),
          and(eq(updatedAtMs, after.updatedAt), gt(verifyRuns.id, after.id)),
        )!,
      );
    }

    return db
      .select()
      .from(verifyRuns)
      .where(and(...conditions))
      .orderBy(asc(updatedAtMs), asc(verifyRuns.id))
      .limit(limit);
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
    value: Partial<
      Pick<NewVerifyRun, 'context' | 'goal' | 'metadata' | 'plan' | 'scenario' | 'title'>
    >,
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
