import type { VerifyReport } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { verifyReports, verifyRuns } from '../schemas/verify';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

/** Caller-supplied fields when writing a report (ownership + timestamps are injected). */
type CreateVerifyReport = Omit<VerifyReport, 'id' | 'createdAt' | 'generatedAt'>;

export class VerifyReportModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, verifyReports);

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

  /**
   * Write the report for a session. A report is unique per run (regenerating
   * overwrites in place), so this upserts on the `verify_run_id` unique index
   * rather than ever inserting a second row.
   */
  upsertByRun = async (params: CreateVerifyReport) => {
    await this.assertRunOwned(params.verifyRunId);

    const values = buildWorkspacePayload(
      { userId: this.userId, workspaceId: this.workspaceId },
      params,
    );

    // The conflict target and ownership keys identify the row, so they're excluded from the set.
    const {
      verifyRunId: _verifyRunId,
      userId: _userId,
      workspaceId: _workspaceId,
      ...mutable
    } = values;

    const [result] = await this.db
      .insert(verifyReports)
      .values(values)
      .onConflictDoUpdate({
        set: mutable,
        setWhere: this.ownership(),
        target: verifyReports.verifyRunId,
      })
      .returning();

    if (!result) {
      throw new Error(`Verify report "${params.verifyRunId}" not found in the current workspace`);
    }

    return result;
  };

  findById = async (id: string) => {
    return this.db.query.verifyReports.findFirst({
      where: and(eq(verifyReports.id, id), this.ownership()),
    });
  };

  /** The single report for one verification session, or undefined when not yet generated. */
  findByRun = async (verifyRunId: string) => {
    return this.db.query.verifyReports.findFirst({
      where: and(eq(verifyReports.verifyRunId, verifyRunId), this.ownership()),
    });
  };

  update = async (id: string, value: Partial<Omit<VerifyReport, 'id'>>) => {
    return this.db
      .update(verifyReports)
      .set(value)
      .where(and(eq(verifyReports.id, id), this.ownership()));
  };

  /** Record that the user has acknowledged the report. */
  markReviewed = async (verifyRunId: string) => {
    return this.db
      .update(verifyReports)
      .set({ reviewedByUser: true })
      .where(and(eq(verifyReports.verifyRunId, verifyRunId), this.ownership()));
  };

  delete = async (id: string) => {
    return this.db.delete(verifyReports).where(and(eq(verifyReports.id, id), this.ownership()));
  };
}
