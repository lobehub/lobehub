import type { VerifyEvidence } from '@lobechat/types';
import { and, asc, eq } from 'drizzle-orm';

import { verifyEvidence } from '../schemas/verify';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

/** Caller-supplied fields when recording one evidence artifact (ownership is injected). */
type CreateVerifyEvidence = Omit<VerifyEvidence, 'id' | 'createdAt'>;

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

  delete = async (id: string) => {
    return this.db.delete(verifyEvidence).where(and(eq(verifyEvidence.id, id), this.ownership()));
  };
}
