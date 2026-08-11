import { TRACING_SCENARIOS } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import debug from 'debug';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import { VerifyReviewPredictionModel } from '@/database/models/verifyReviewPrediction';
import type { VerifyCheckResultItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';
import { FileService } from '@/server/services/file';

import { buildReviewPredictPrompt, REVIEW_PREDICT_PROMPT_VERSION } from './prompts';
import type { RawReviewPrediction } from './schema';
import { REVIEW_PREDICTION_JSON_SCHEMA, ReviewPredictionSchema } from './schema';

const log = debug('lobe-server:verify-review-predictor');

/** Media a still frame can actually carry a judgement about. */
const VISUAL_EVIDENCE_TYPES = new Set(['screenshot', 'gif']);

/**
 * Cap on frames per request. Three covers essentially every check in the
 * offline sample (only 15 of 187 had more), and each frame costs ~1.2k input
 * tokens — so an unbounded fan-out would be paid on every check forever to
 * serve a long tail that barely exists.
 */
const MAX_VISUALS = 3;

export interface PredictReviewParams {
  /** The check result to re-judge. */
  checkResultId: string;
  /** The check's detailed judging rubric, when the criterion links one. */
  instructionDocumentId?: string | null;
  modelConfig: { model: string; provider: string };
  /** The acceptance's requirement, used as the scope test. */
  requirement?: string | null;
  surface?: string | null;
}

/**
 * Whether a stored proposal should still be shown to the reviewer.
 *
 * Both reasons to withhold one were real defects when missing:
 *  - the reviewer already answered this proposal — `not-an-issue` and
 *    `misidentified` deliberately leave the CHECK unjudged, so gating on the
 *    check's verdict alone resurrects a dismissed card on every reload;
 *  - the check itself has been ruled on, so the proposal has nothing left to ask.
 */
export const shouldSurfaceProposal = (
  prediction: { adjudication?: string | null },
  hasUserReview: boolean,
): boolean => !hasUserReview && !prediction.adjudication;

/**
 * Produces an automated second opinion on a check the verifier already judged.
 *
 * Deliberately a SHADOW lane: the verdict lands in `verify_review_predictions`
 * and never touches `verify_check_results.user_decision`. The human decision
 * stays the one ground truth, which is what makes the two comparable at all —
 * the moment a prediction can write into the label column, every agreement
 * statistic computed afterwards is measuring the model against itself.
 */
export class VerifyReviewPredictorService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;
  private readonly resultModel: VerifyCheckResultModel;
  private readonly evidenceModel: VerifyEvidenceModel;
  private readonly predictionModel: VerifyReviewPredictionModel;
  private readonly documentModel: DocumentModel;
  private readonly fileModel: FileModel;
  private readonly fileService: FileService;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.resultModel = new VerifyCheckResultModel(db, userId, workspaceId);
    this.evidenceModel = new VerifyEvidenceModel(db, userId, workspaceId);
    this.predictionModel = new VerifyReviewPredictionModel(db, userId, workspaceId);
    this.documentModel = new DocumentModel(db, userId, workspaceId);
    this.fileModel = new FileModel(db, userId, workspaceId);
    this.fileService = new FileService(db, userId, workspaceId);
  }

  /**
   * Re-judge one check. Returns null (rather than throwing) whenever the check
   * cannot be judged — no visual evidence, model failure — because this runs
   * opportunistically behind the reviewer's own work and must never take a page
   * down with it.
   */
  async predict(params: PredictReviewParams) {
    const { checkResultId, modelConfig } = params;

    const result = await this.resultModel.findById(checkResultId);
    if (!result) return null;

    const visuals = await this.collectVisuals(result);
    // Nothing to look at means nothing this reviewer can honestly say. A
    // text-only opinion here would be the model paraphrasing the verifier's own
    // reasoning back at the user, which is worse than silence.
    if (visuals.length === 0) {
      log('predict: %s has no visual evidence, skipping', checkResultId);
      return null;
    }

    const instruction = params.instructionDocumentId
      ? ((await this.documentModel.findById(params.instructionDocumentId))?.content ?? undefined)
      : undefined;

    const { system, user } = buildReviewPredictPrompt({
      instruction,
      requirement: params.requirement ?? undefined,
      surface: params.surface ?? undefined,
      title: result.checkItemTitle ?? 'Acceptance check',
      toulmin: (result.toulmin ?? undefined) as
        { evidence?: string; reasoning?: string } | undefined,
      verdict: result.verdict ?? undefined,
      visuals: visuals.map((visual) => visual.description ?? ''),
    });

    const startedAt = Date.now();
    let raw: unknown;
    try {
      const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);
      raw = await ai.generateObject(
        {
          messages: [
            { content: system, role: 'system' as const },
            {
              content: [
                { text: user, type: 'text' as const },
                ...visuals.map((visual) => ({
                  image_url: { detail: 'high' as const, url: visual.accessUrl },
                  type: 'image_url' as const,
                })),
              ],
              role: 'user' as const,
            },
          ],
          model: modelConfig.model,
          provider: modelConfig.provider,
          schema: REVIEW_PREDICTION_JSON_SCHEMA,
        },
        {
          tracing: {
            promptVersion: REVIEW_PREDICT_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.ReviewPredict,
            schemaName: REVIEW_PREDICTION_JSON_SCHEMA.name,
          } satisfies TracingOptions,
        },
      );
    } catch (error) {
      log('predict: model call failed for %s — %O', checkResultId, error);
      return null;
    }

    const parsed = ReviewPredictionSchema.safeParse(raw);
    if (!parsed.success) {
      log('predict: unparseable output for %s — %O', checkResultId, parsed.error.flatten());
      return null;
    }

    const prediction = parsed.data;
    // An `accept` carries no proposal for the reviewer to act on — the check
    // already reads as passing. Persisting it would grow the table by ~4x for a
    // card that renders nothing.
    if (prediction.action === 'accept') {
      log('predict: %s judged accept, nothing to propose', checkResultId);
      return null;
    }

    const annotations = this.toAnnotations(prediction.regions, visuals);

    return this.predictionModel.upsert({
      action: prediction.action,
      annotations,
      checkResultId,
      comment: prediction.comment ?? undefined,
      confidence: prediction.confidence ?? undefined,
      latencyMs: Date.now() - startedAt,
      model: modelConfig.model,
      provider: modelConfig.provider,
      promptVersion: REVIEW_PREDICT_PROMPT_VERSION,
      rationale: prediction.rationale ?? undefined,
    });
  }

  /**
   * Evidence frames the model can actually read, resolved to model-readable
   * URLs. Order matters: `imageIndex` in the model's answer refers to a position
   * in this array, and that index is how a region gets bound back to the
   * evidence row it was drawn on.
   */
  private async collectVisuals(result: VerifyCheckResultItem) {
    const evidence = await this.evidenceModel.listByCheckResult(result.id);
    const visual = evidence
      .filter((row) => VISUAL_EVIDENCE_TYPES.has(row.type) && row.fileId)
      .slice(0, MAX_VISUALS);

    const resolved = await Promise.all(
      visual.map(async (row) => {
        const file = await this.fileModel.findById(row.fileId!);
        if (!file) return null;
        return {
          accessUrl: await this.fileService.getFileAccessUrl({ id: file.id, url: file.url }),
          description: row.description,
          evidenceId: row.id,
        };
      }),
    );

    return resolved.filter(
      (item): item is { accessUrl: string; description: string | null; evidenceId: string } =>
        Boolean(item?.accessUrl),
    );
  }

  /**
   * Bind the model's regions to the evidence rows they were drawn on, producing
   * exactly the shape the human's own annotations use — so a confirmed proposal
   * becomes a real reject with no coordinate or schema conversion.
   *
   * A region naming an image outside the attached set is dropped rather than
   * clamped to image 0: a note pinned to the wrong screenshot is more misleading
   * than no note, because the reviewer has no way to tell it moved.
   */
  private toAnnotations(
    regions: RawReviewPrediction['regions'],
    visuals: { evidenceId: string }[],
  ): AcceptanceReviewAnnotation[] {
    return (regions ?? []).flatMap((region) => {
      const target = visuals[region.imageIndex];
      if (!target) return [];
      return [
        {
          comment: region.comment ?? undefined,
          evidenceId: target.evidenceId,
          rect: {
            height: region.height,
            width: region.width,
            x: region.x,
            y: region.y,
          },
        },
      ];
    });
  }
}
