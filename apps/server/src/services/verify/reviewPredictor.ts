import { TRACING_SCENARIOS } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import {
  chainVerifyReviewPrediction,
  REVIEW_PREDICT_PROMPT_VERSION,
  REVIEW_PREDICTION_JSON_SCHEMA,
} from '@lobechat/prompts';
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

import type { RawReviewPrediction } from './schema';
import { ReviewPredictionSchema } from './schema';

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

/**
 * How many checks may be judged at once when a whole acceptance is requested.
 *
 * Each prediction is a multimodal generation carrying up to three images, so
 * this is the knob that decides whether one click is a steady queue or a burst
 * the provider rate-limits. Four keeps a thirty-check acceptance finishing in a
 * couple of minutes without ever opening more than four generations.
 */
export const REVIEW_PREDICT_CONCURRENCY = 4;

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
 * Whether a stored prediction should be shown to the reviewer as a proposal.
 *
 * Every attempt is persisted, including the ones with nothing to say, so this is
 * where "we have a row" narrows to "the reviewer should look at something":
 *  - only a `reject` is a proposal at all — an `accept`, a skip and an error are
 *    recorded for the agreement stats and render no card;
 *  - the reviewer already answered this proposal — `not-an-issue` and
 *    `misidentified` deliberately leave the CHECK unjudged, so gating on the
 *    check's verdict alone resurrects a dismissed card on every reload;
 *  - the check itself has been ruled on, so the proposal has nothing left to ask.
 */
export const shouldSurfaceProposal = <
  T extends { action?: string | null; adjudication?: string | null },
>(
  prediction: T,
  hasUserReview: boolean,
  // A type predicate, not a plain boolean: the card's own `action: 'reject'`
  // field is only true BECAUSE of this gate, so narrowing here is what stops the
  // two from drifting — widen the gate and the UI type stops compiling.
): prediction is T & { action: 'reject' } =>
  prediction.action === 'reject' && !hasUserReview && !prediction.adjudication;

/**
 * Whether a stored row is the opinion of the reviewer currently in service.
 *
 * Rows from an earlier pin (a different model, or an older prompt version)
 * stay in the table for the comparison set, but they are not what the page
 * shows or what a fresh request is waiting on: reading the newest row across
 * models let a stale verdict satisfy "the batch finished" the moment the
 * current model's row was cleared for re-judging.
 */
export const isCurrentReviewPrediction = (
  prediction: { model: string; promptVersion: string; provider: string },
  modelConfig: { model: string; provider: string },
): boolean =>
  prediction.provider === modelConfig.provider &&
  prediction.model === modelConfig.model &&
  prediction.promptVersion === REVIEW_PREDICT_PROMPT_VERSION;

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
   * Forget the unanswered attempts a new batch is about to replace, so that a
   * missing row means "not judged yet" for every check in the batch. Called
   * BEFORE the batch is dispatched — the reset is what lets a poller tell a
   * finished batch from the previous run's leftovers.
   */
  async resetPending(checkResultIds: string[], modelConfig: { model: string; provider: string }) {
    await this.predictionModel.resetUnadjudicated(checkResultIds, {
      model: modelConfig.model,
      promptVersion: REVIEW_PREDICT_PROMPT_VERSION,
      provider: modelConfig.provider,
    });
  }

  /**
   * Re-judge one check.
   *
   * Never throws: this runs opportunistically behind the reviewer's own work and
   * must not take a page down with it. Anything that stops a verdict from
   * forming — no frame to look at, a provider failure, unparseable output — is
   * written as a non-`judged` row instead, so the attempt stays visible to the
   * analysis set. Only a check that does not exist, or one whose proposal has
   * already been answered, returns null.
   */
  async predict(params: PredictReviewParams) {
    const { checkResultId, modelConfig } = params;

    const result = await this.resultModel.findById(checkResultId);
    if (!result) return null;

    // An answered proposal is a recorded label. Re-running the SAME model +
    // prompt version would upsert over it and destroy the reviewer's verdict —
    // and the ordinary UI reaches here easily, because `not-an-issue` leaves
    // the check pending so the request button stays available. Skipping also
    // avoids paying for an opinion that already has its answer.
    const existing = await this.predictionModel.findAdjudicated(
      checkResultId,
      modelConfig.provider,
      modelConfig.model,
      REVIEW_PREDICT_PROMPT_VERSION,
    );
    if (existing) {
      log('predict: %s already adjudicated (%s), skipping', checkResultId, existing.adjudication);
      return null;
    }

    const visuals = await this.collectVisuals(result);
    // Nothing to look at means nothing this reviewer can honestly say. A
    // text-only opinion here would be the model paraphrasing the verifier's own
    // reasoning back at the user, which is worse than silence.
    if (visuals.length === 0) {
      log('predict: %s has no visual evidence, skipping', checkResultId);
      return this.record(params, 'skipped', 'no visual evidence to judge');
    }

    const instruction = params.instructionDocumentId
      ? ((await this.documentModel.findById(params.instructionDocumentId))?.content ?? undefined)
      : undefined;

    const chain = chainVerifyReviewPrediction({
      instruction,
      requirement: params.requirement ?? undefined,
      surface: params.surface ?? undefined,
      title: result.checkItemTitle ?? 'Acceptance check',
      toulmin: (result.toulmin ?? undefined) as
        { evidence?: string; reasoning?: string } | undefined,
      verdict: result.verdict ?? undefined,
      visuals,
    });

    const startedAt = Date.now();
    let raw: unknown;
    try {
      const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);
      raw = await ai.generateObject(
        {
          ...chain,
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
      return this.record(params, 'errored', error instanceof Error ? error.message : String(error));
    }

    const parsed = ReviewPredictionSchema.safeParse(raw);
    if (!parsed.success) {
      log('predict: unparseable output for %s — %O', checkResultId, parsed.error.flatten());
      return this.record(params, 'errored', 'model output did not match the schema');
    }

    const prediction = parsed.data;
    const annotations = this.toAnnotations(prediction.regions, visuals);

    // An `accept` renders no card, but it is still the model's opinion and the
    // row is what makes miss rate computable: without it, "the model passed
    // this" is indistinguishable from "we never looked".

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
      status: 'judged',
    });
  }

  /**
   * Record an attempt that produced no verdict. Kept as a row rather than a
   * silent `return null` so the analysis set can tell "nothing to judge" and
   * "the call broke" apart from "the model approved it".
   */
  private record(params: PredictReviewParams, status: 'errored' | 'skipped', reason: string) {
    return this.predictionModel.upsert({
      checkResultId: params.checkResultId,
      model: params.modelConfig.model,
      promptVersion: REVIEW_PREDICT_PROMPT_VERSION,
      provider: params.modelConfig.provider,
      status,
      statusReason: reason,
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
