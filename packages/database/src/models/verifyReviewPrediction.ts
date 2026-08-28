import type { ReviewAdjudication, ReviewProposalEdit } from '@lobechat/types';
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import type { NewVerifyReviewPrediction } from '../schemas/verify';
import { verifyCheckResults, verifyReviewPredictions } from '../schemas/verify';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

/** Caller-supplied fields for one prediction (ownership is injected). */
type CreateVerifyReviewPrediction = Omit<
  NewVerifyReviewPrediction,
  'id' | 'createdAt' | 'userId' | 'workspaceId'
>;

/** A prediction annotated with the run-stable `checkItemId` of the result it judges. */
export type VerifyReviewPredictionForRuns = typeof verifyReviewPredictions.$inferSelect & {
  checkItemId: string;
  verifyRunId: string;
};

export class VerifyReviewPredictionModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      verifyReviewPredictions,
    );

  /**
   * Record one opinion, replacing any earlier one from the same model + prompt
   * version. Upsert rather than insert because the predictor is re-runnable by
   * design (a retry, a backfill, a manual re-request); stacking rows would let
   * one check contribute several votes to the agreement stats.
   */
  upsert = async (params: CreateVerifyReviewPrediction) => {
    const [row] = await this.db
      .insert(verifyReviewPredictions)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, params))
      .onConflictDoUpdate({
        set: {
          // `?? null` on every optional column, not `params.x` — drizzle drops an
          // `undefined` from the SET clause, so a later attempt that carries no
          // verdict (skipped / errored) would otherwise leave the previous run's
          // action and comment sitting under its new status.
          action: params.action ?? null,
          // A replacement opinion has not been answered — carrying the previous
          // adjudication forward would attach the reviewer's verdict to text
          // they never saw, and permanently hide the new proposal.
          adjudicatedAt: null,
          adjudication: null,
          adjudicationEdit: null,
          annotations: params.annotations ?? null,
          comment: params.comment ?? null,
          completionTokens: params.completionTokens ?? null,
          confidence: params.confidence ?? null,
          createdAt: new Date(),
          latencyMs: params.latencyMs ?? null,
          promptTokens: params.promptTokens ?? null,
          rationale: params.rationale ?? null,
          status: params.status,
          statusReason: params.statusReason ?? null,
        },
        target: [
          verifyReviewPredictions.checkResultId,
          verifyReviewPredictions.provider,
          verifyReviewPredictions.model,
          verifyReviewPredictions.promptVersion,
        ],
      })
      .returning();

    return row;
  };

  /**
   * Record the reviewer's answer to a proposal.
   *
   * Separate from any check decision on purpose: `not-an-issue` and
   * `misidentified` leave the check itself unjudged — the reviewer has answered
   * the model, not the delivery — so there is no `user_decision` row to carry
   * them.
   */
  adjudicate = async (
    id: string,
    params: { adjudication: ReviewAdjudication; edit?: ReviewProposalEdit },
  ) => {
    const [row] = await this.db
      .update(verifyReviewPredictions)
      .set({
        adjudicatedAt: new Date(),
        adjudication: params.adjudication,
        adjudicationEdit: params.edit ?? null,
      })
      .where(and(eq(verifyReviewPredictions.id, id), this.ownership()))
      .returning();

    return row;
  };

  /**
   * The answered proposal for this exact (result, model, prompt version), if
   * one exists. The predictor consults it before spending a model call: an
   * upsert over an adjudicated row would erase a recorded label.
   */
  findAdjudicated = async (
    checkResultId: string,
    provider: string,
    model: string,
    promptVersion: string,
  ) =>
    this.db.query.verifyReviewPredictions.findFirst({
      where: and(
        eq(verifyReviewPredictions.checkResultId, checkResultId),
        eq(verifyReviewPredictions.provider, provider),
        eq(verifyReviewPredictions.model, model),
        eq(verifyReviewPredictions.promptVersion, promptVersion),
        isNotNull(verifyReviewPredictions.adjudication),
        this.ownership(),
      ),
    });

  /**
   * Clear the unanswered opinions of one model + prompt version on a set of
   * results, so a fresh batch starts from "no attempt recorded".
   *
   * The predictor upserts on completion, which means a re-request leaves the
   * PREVIOUS attempt sitting under each check until its replacement lands —
   * and a client waiting for "every check has a recorded attempt" then sees
   * that condition met before a single new call has finished. Nothing is lost
   * that the upsert would not have overwritten anyway; adjudicated rows are
   * kept because they are recorded labels and the predictor skips them.
   */
  resetUnadjudicated = async (
    checkResultIds: string[],
    identity: { model: string; promptVersion: string; provider: string },
  ) => {
    if (checkResultIds.length === 0) return;

    await this.db
      .delete(verifyReviewPredictions)
      .where(
        and(
          inArray(verifyReviewPredictions.checkResultId, checkResultIds),
          eq(verifyReviewPredictions.provider, identity.provider),
          eq(verifyReviewPredictions.model, identity.model),
          eq(verifyReviewPredictions.promptVersion, identity.promptVersion),
          isNull(verifyReviewPredictions.adjudication),
          this.ownership(),
        ),
      );
  };

  findById = async (id: string) =>
    this.db.query.verifyReviewPredictions.findFirst({
      where: and(eq(verifyReviewPredictions.id, id), this.ownership()),
    });

  /** The newest opinion per check result across a whole round chain.
   *
   * Returns every prediction (newest first) rather than pre-reducing to one per
   * result: the caller knows which model version it wants to show, and a future
   * comparison view needs them all. Callers that want "the current one" take the
   * first match for their model id.
   */
  listByRuns = async (verifyRunIds: string[]): Promise<VerifyReviewPredictionForRuns[]> => {
    if (verifyRunIds.length === 0) return [];

    const rows = await this.db
      .select({
        checkItemId: verifyCheckResults.checkItemId,
        prediction: verifyReviewPredictions,
        verifyRunId: verifyCheckResults.verifyRunId,
      })
      .from(verifyReviewPredictions)
      .innerJoin(
        verifyCheckResults,
        eq(verifyReviewPredictions.checkResultId, verifyCheckResults.id),
      )
      .where(and(inArray(verifyCheckResults.verifyRunId, verifyRunIds), this.ownership()))
      .orderBy(desc(verifyReviewPredictions.createdAt));

    return rows.map((r) => ({
      ...r.prediction,
      checkItemId: r.checkItemId,
      // The join filter guarantees a run id; the column is only nullable for legacy rows.
      verifyRunId: r.verifyRunId!,
    }));
  };

  listByCheckResult = async (checkResultId: string) =>
    this.db
      .select()
      .from(verifyReviewPredictions)
      .where(and(eq(verifyReviewPredictions.checkResultId, checkResultId), this.ownership()))
      .orderBy(desc(verifyReviewPredictions.createdAt));
}
