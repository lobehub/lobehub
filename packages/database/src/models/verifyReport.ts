import type { VerifyReport } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { verifyReports } from '../schemas/verify';
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

  /**
   * Write the report for a session. A report is unique per run (regenerating
   * overwrites in place), so this upserts on the `verify_run_id` unique index
   * rather than ever inserting a second row.
   */
  upsertByRun = async (params: CreateVerifyReport) => {
    const values = buildWorkspacePayload(
      { userId: this.userId, workspaceId: this.workspaceId },
      params,
    );

    // `verify_run_id` is the conflict key, so it's excluded from the update set.
    const { verifyRunId: _verifyRunId, ...mutable } = values;

    const [result] = await this.db
      .insert(verifyReports)
      .values(values)
      .onConflictDoUpdate({ set: mutable, target: verifyReports.verifyRunId })
      .returning();

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
