import {
  REVIEW_PREDICTION_ACTIONS,
  VERIFY_EVIDENCE_MODALITIES,
  VERIFY_EVIDENCE_SCOPES,
  VERIFY_EVIDENCE_TYPES,
  VERIFY_ON_FAIL_ACTIONS,
  VERIFY_VERDICTS,
  VERIFY_VERIFIER_TYPES,
} from '@lobechat/prompts';
import { z } from 'zod';

// ============================================
// Plan generation — AI proposes additional check criteria for a run
// ============================================

/**
 * Models that do not enforce JSON-schema enums (DeepSeek via forced tool
 * calling) put the evidence *modality* into `type` — `document`, `structured`,
 * `image`. Map those back to the capture type they mean.
 */
const EVIDENCE_TYPE_BY_MODALITY: Record<string, (typeof VERIFY_EVIDENCE_TYPES)[number]> = {
  document: 'markdown',
  image: 'screenshot',
  structured: 'text',
};

const requiredEvidenceSchema = z.object({
  hint: z.string().optional(),
  modality: z.enum(VERIFY_EVIDENCE_MODALITIES).optional().catch(undefined),
  scope: z.enum(VERIFY_EVIDENCE_SCOPES).optional().catch(undefined),
  type: z.preprocess(
    (value) => (typeof value === 'string' ? (EVIDENCE_TYPE_BY_MODALITY[value] ?? value) : value),
    z.enum(VERIFY_EVIDENCE_TYPES),
  ),
});

const generatedCriterionSchema = z.object({
  description: z.string().optional(),
  instruction: z.string().optional(),
  onFail: z.enum(VERIFY_ON_FAIL_ACTIONS).optional().catch(undefined),
  // One malformed evidence spec drops that spec, not the criterion.
  requiredEvidence: z
    .array(z.unknown())
    .optional()
    .catch(undefined)
    .transform((items) =>
      items?.flatMap((item) => {
        const parsed = requiredEvidenceSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
  required: z.boolean().optional().catch(undefined),
  title: z.string(),
  verifierType: z.enum(VERIFY_VERIFIER_TYPES),
});

/**
 * Lenient parse of the AI plan-gen output; the service filters/normalizes.
 *
 * Each criterion is parsed on its own: a single off-schema field used to fail
 * the whole object, the plan came back empty, and the checklist silently
 * collapsed to the one holistic fallback row.
 */
export const RawGeneratedCriteriaSchema = z.object({
  criteria: z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const parsed = generatedCriterionSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

export type RawGeneratedCriteria = z.infer<typeof RawGeneratedCriteriaSchema>;

// ============================================
// LLM Judge — Toulmin verdict for one or many check items
// ============================================

const toulminVerdictFields = {
  confidence: z.number().min(0).max(1),
  // `.nullish()` (null | undefined), not `.optional()`: the judge JSON schema is
  // non-strict and lists these as optional, so the provider returns them as
  // explicit `null` (not omitted). `.optional()` rejects null → whole parse fails.
  counterEvidence: z.string().nullish(),
  evidence: z.string().nullish(),
  limitation: z.string().nullish(),
  reasoning: z.string().nullish(),
  suggestion: z.string().nullish(),
  verdict: z.enum(VERIFY_VERDICTS),
};

/** Per-criterion judge output (1:1 — one generateObject per check item). */
export const SingleVerdictSchema = z.object(toulminVerdictFields);
export type SingleVerdict = z.infer<typeof SingleVerdictSchema>;

/** Batch judge output — N verdicts keyed by stable check item id. */
export const BatchVerdictSchema = z.object({
  verdicts: z.array(z.object({ ...toulminVerdictFields, checkItemId: z.string() })),
});
export type BatchVerdict = z.infer<typeof BatchVerdictSchema>;

// ============================================
// Report — LLM narrative over a run's check results + evidence
// ============================================

/**
 * Only the narrative is LLM-authored; the verdict + statistics are computed
 * deterministically from the results, so the report card can never disagree with
 * the underlying rollup.
 */
export const ReportNarrativeSchema = z.object({
  content: z.string(),
  summary: z.string(),
});
export type ReportNarrative = z.infer<typeof ReportNarrativeSchema>;

// ============================================
// Review prediction — a second opinion on one already-judged check
// ============================================

/**
 * Lenient on purpose: `strict: true` forces every property into `required`, so
 * the provider returns explicit `null` for the ones it had nothing to say about
 * — hence `.nullish()` rather than `.optional()` throughout.
 */
export const ReviewPredictionSchema = z.object({
  action: z.enum(REVIEW_PREDICTION_ACTIONS),
  comment: z.string().nullish(),
  confidence: z.number().nullish(),
  rationale: z.string().nullish(),
  regions: z
    .array(
      z.object({
        comment: z.string().nullish(),
        height: z.number(),
        imageIndex: z.number(),
        width: z.number(),
        x: z.number(),
        y: z.number(),
      }),
    )
    .nullish(),
});
export type RawReviewPrediction = z.infer<typeof ReviewPredictionSchema>;
