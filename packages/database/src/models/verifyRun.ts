import type { VerifyCheckItem, VerifyRunSource, VerifyRunStatus } from '@lobechat/types';
import { and, eq, isNull } from 'drizzle-orm';

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
  verifyStatus: VerifyRunStatus | null;
}

const toState = (run: VerifyRunItem | null | undefined): VerifyRunState | null =>
  run
    ? {
        verifyPlan: (run.plan ?? null) as VerifyCheckItem[] | null,
        verifyPlanConfirmedAt: run.planConfirmedAt ?? null,
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

  create = async (
    params: Omit<NewVerifyRun, 'userId' | 'workspaceId'> & { source?: VerifyRunSource },
  ): Promise<VerifyRunItem> => {
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

  /** Update the denormalized rollup. Always go through the service-layer chokepoint. */
  updateStatus = async (runId: string, status: VerifyRunStatus | null): Promise<void> => {
    await this.db
      .update(verifyRuns)
      .set({ status })
      .where(and(eq(verifyRuns.id, runId), this.ownership()));
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
