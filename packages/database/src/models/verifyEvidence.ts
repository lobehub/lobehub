import type { VerifyEvidence } from '@lobechat/types';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { verifyCheckResults, verifyEvidence } from '../schemas/verify';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

/** Caller-supplied fields when recording one evidence artifact (ownership is injected). */
type CreateVerifyEvidence = Omit<VerifyEvidence, 'id' | 'createdAt'>;

/** An evidence row annotated with the run-stable `checkItemId` of its result. */
export type VerifyEvidenceForRun = VerifyEvidence & { checkItemId: string };

/** An evidence row annotated with both its check item and the round it came from. */
export type VerifyEvidenceForRuns = VerifyEvidenceForRun & { verifyRunId: string };

export class VerifyEvidenceModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, verifyEvidence);

  create = async (params: CreateVerifyEvidence) => {
    const [result] = await this.db
      .insert(verifyEvidence)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, params))
      .returning();

    return result;
  };

  /** Batch-insert the artifacts captured by a single probe / verifier run. */
  createMany = async (rows: CreateVerifyEvidence[]) => {
    if (rows.length === 0) return [];
    return this.db
      .insert(verifyEvidence)
      .values(
        rows.map((r) =>
          buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, r),
        ),
      )
      .returning();
  };

  findById = async (id: string) => {
    return this.db.query.verifyEvidence.findFirst({
      where: and(eq(verifyEvidence.id, id), this.ownership()),
    });
  };

  /**
   * All evidence for one check result, oldest first. The table is flat (no
   * `parent_evidence_id`) — a recursive evidence chain is modelled as a new check,
   * so this single query is the whole "tree" for a result.
   */
  listByCheckResult = async (checkResultId: string) => {
    return this.db
      .select()
      .from(verifyEvidence)
      .where(and(eq(verifyEvidence.checkResultId, checkResultId), this.ownership()))
      .orderBy(asc(verifyEvidence.createdAt));
  };

  /**
   * All evidence for a whole verification session, each row carrying the
   * `checkItemId` of the result it backs (joined through `verify_check_results`).
   * Lets the judge and reporter group a run's artifacts by plan item in one
   * query, oldest first.
   */
  listByRun = async (verifyRunId: string): Promise<VerifyEvidenceForRun[]> => {
    const rows = await this.db
      .select({
        checkItemId: verifyCheckResults.checkItemId,
        evidence: verifyEvidence,
      })
      .from(verifyEvidence)
      .innerJoin(verifyCheckResults, eq(verifyEvidence.checkResultId, verifyCheckResults.id))
      .where(and(eq(verifyCheckResults.verifyRunId, verifyRunId), this.ownership()))
      .orderBy(asc(verifyEvidence.createdAt));

    return rows.map((r) => ({ ...r.evidence, checkItemId: r.checkItemId }));
  };

  /**
   * All evidence across several verification rounds in one query, each row
   * carrying its result's `checkItemId` and the round (`verifyRunId`) it was
   * captured in — the acceptance union joins a whole round chain at once.
   */
  listByRuns = async (verifyRunIds: string[]): Promise<VerifyEvidenceForRuns[]> => {
    if (verifyRunIds.length === 0) return [];

    const rows = await this.db
      .select({
        checkItemId: verifyCheckResults.checkItemId,
        evidence: verifyEvidence,
        verifyRunId: verifyCheckResults.verifyRunId,
      })
      .from(verifyEvidence)
      .innerJoin(verifyCheckResults, eq(verifyEvidence.checkResultId, verifyCheckResults.id))
      .where(and(inArray(verifyCheckResults.verifyRunId, verifyRunIds), this.ownership()))
      .orderBy(asc(verifyEvidence.createdAt));

    return rows.map((r) => ({
      ...r.evidence,
      checkItemId: r.checkItemId,
      // The join filter guarantees a run id; the column is only nullable for legacy rows.
      verifyRunId: r.verifyRunId!,
    }));
  };

  delete = async (id: string) => {
    return this.db.delete(verifyEvidence).where(and(eq(verifyEvidence.id, id), this.ownership()));
  };
}
