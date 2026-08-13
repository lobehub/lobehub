import type { GenerateObjectSchema } from '@lobechat/model-runtime';
import { z } from 'zod';

// ============================================
// Plan generation — AI proposes additional check criteria for a run
// ============================================

const verifierTypeEnum = ['program', 'agent', 'llm'] as const;
const onFailEnum = ['manual', 'auto_repair'] as const;
const evidenceTypeEnum = [
  'screenshot',
  'gif',
  'video',
  'audio',
  'text',
  'markdown',
  'dom_snapshot',
  'transcript',
] as const;
const evidenceModalityEnum = ['audio', 'document', 'image', 'structured', 'text', 'video'] as const;
const evidenceScopeEnum = ['deliverable', 'run_evidence', 'task_artifacts'] as const;

const requiredEvidenceSchema = z.object({
  hint: z.string().optional(),
  modality: z.enum(evidenceModalityEnum).optional(),
  scope: z.enum(evidenceScopeEnum).optional(),
  type: z.enum(evidenceTypeEnum),
});

/** Lenient parse of the AI plan-gen output; the service filters/normalizes. */
export const RawGeneratedCriteriaSchema = z.object({
  criteria: z.array(
    z.object({
      description: z.string().optional(),
      instruction: z.string().optional(),
      onFail: z.enum(onFailEnum).optional(),
      requiredEvidence: z.array(requiredEvidenceSchema).optional(),
      required: z.boolean().optional(),
      title: z.string(),
      verifierType: z.enum(verifierTypeEnum),
    }),
  ),
});

export type RawGeneratedCriteria = z.infer<typeof RawGeneratedCriteriaSchema>;

/** JSON schema form bound to the LLM structured-output call. */
export const GENERATED_CRITERIA_JSON_SCHEMA: GenerateObjectSchema = {
  name: 'verify_plan_criteria',
  schema: {
    additionalProperties: false,
    properties: {
      criteria: {
        items: {
          additionalProperties: false,
          properties: {
            description: { maxLength: 280, type: 'string' },
            instruction: { type: 'string' },
            onFail: { enum: [...onFailEnum], type: 'string' },
            requiredEvidence: {
              items: {
                additionalProperties: false,
                properties: {
                  hint: { type: 'string' },
                  modality: { enum: [...evidenceModalityEnum], type: 'string' },
                  scope: { enum: [...evidenceScopeEnum], type: 'string' },
                  type: { enum: [...evidenceTypeEnum], type: 'string' },
                },
                required: ['type', 'modality', 'scope', 'hint'],
                type: 'object',
              },
              type: 'array',
            },
            required: { type: 'boolean' },
            title: { maxLength: 80, minLength: 1, type: 'string' },
            verifierType: { enum: [...verifierTypeEnum], type: 'string' },
          },
          required: [
            'title',
            'description',
            'instruction',
            'verifierType',
            'required',
            'onFail',
            'requiredEvidence',
          ],
          type: 'object',
        },
        maxItems: 8,
        type: 'array',
      },
    },
    required: ['criteria'],
    type: 'object',
  },
  strict: true,
};

// ============================================
// LLM Judge — Toulmin verdict for one or many check items
// ============================================

const verdictEnum = ['passed', 'failed', 'uncertain'] as const;

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
  verdict: z.enum(verdictEnum),
};

/** Per-criterion judge output (1:1 — one generateObject per check item). */
export const SingleVerdictSchema = z.object(toulminVerdictFields);
export type SingleVerdict = z.infer<typeof SingleVerdictSchema>;

/** Batch judge output — N verdicts keyed by stable check item id. */
export const BatchVerdictSchema = z.object({
  verdicts: z.array(z.object({ ...toulminVerdictFields, checkItemId: z.string() })),
});
export type BatchVerdict = z.infer<typeof BatchVerdictSchema>;

const toulminJsonProps = {
  confidence: { maximum: 1, minimum: 0, type: 'number' },
  counterEvidence: { type: 'string' },
  evidence: { type: 'string' },
  limitation: { type: 'string' },
  reasoning: { type: 'string' },
  suggestion: { type: 'string' },
  verdict: { enum: [...verdictEnum], type: 'string' },
} as const;

const toulminRequired = ['verdict', 'confidence', 'evidence', 'reasoning'];

export const SINGLE_VERDICT_JSON_SCHEMA: GenerateObjectSchema = {
  name: 'verify_verdict',
  schema: {
    additionalProperties: false,
    properties: { ...toulminJsonProps },
    required: toulminRequired,
    type: 'object',
  },
  strict: false,
};

export const BATCH_VERDICT_JSON_SCHEMA: GenerateObjectSchema = {
  name: 'verify_verdicts',
  schema: {
    additionalProperties: false,
    properties: {
      verdicts: {
        items: {
          additionalProperties: false,
          properties: { checkItemId: { type: 'string' }, ...toulminJsonProps },
          required: ['checkItemId', ...toulminRequired],
          type: 'object',
        },
        type: 'array',
      },
    },
    required: ['verdicts'],
    type: 'object',
  },
  strict: false,
};

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

export const REPORT_NARRATIVE_JSON_SCHEMA: GenerateObjectSchema = {
  name: 'verify_report',
  schema: {
    additionalProperties: false,
    properties: {
      content: { type: 'string' },
      summary: { maxLength: 600, type: 'string' },
    },
    required: ['summary', 'content'],
    type: 'object',
  },
  strict: true,
};

// ============================================
// Review prediction — a second opinion on one already-judged check
// ============================================

const reviewPredictionActionEnum = ['accept', 'reject'] as const;

/**
 * Lenient on purpose: `strict: true` forces every property into `required`, so
 * the provider returns explicit `null` for the ones it had nothing to say about
 * — hence `.nullish()` rather than `.optional()` throughout.
 */
export const ReviewPredictionSchema = z.object({
  action: z.enum(reviewPredictionActionEnum),
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

export const REVIEW_PREDICTION_JSON_SCHEMA: GenerateObjectSchema = {
  name: 'review_prediction',
  schema: {
    additionalProperties: false,
    properties: {
      action: { enum: [...reviewPredictionActionEnum], type: 'string' },
      comment: {
        description: 'One actionable sentence naming what is wrong and where',
        maxLength: 300,
        type: 'string',
      },
      confidence: { maximum: 1, minimum: 0, type: 'number' },
      rationale: {
        description: 'Full reasoning, kept for analysis',
        maxLength: 2000,
        type: 'string',
      },
      regions: {
        description: 'Required when action is reject: the exact regions at fault',
        items: {
          additionalProperties: false,
          properties: {
            comment: { maxLength: 300, type: 'string' },
            // Normalized 0-1 against the whole image, matching how the human's
            // own annotations are stored so a proposal can become a real reject
            // without any coordinate conversion.
            height: { maximum: 1, minimum: 0, type: 'number' },
            imageIndex: { minimum: 0, type: 'integer' },
            width: { maximum: 1, minimum: 0, type: 'number' },
            x: { maximum: 1, minimum: 0, type: 'number' },
            y: { maximum: 1, minimum: 0, type: 'number' },
          },
          required: ['imageIndex', 'x', 'y', 'width', 'height', 'comment'],
          type: 'object',
        },
        maxItems: 5,
        type: 'array',
      },
    },
    required: ['action', 'confidence', 'comment', 'rationale', 'regions'],
    type: 'object',
  },
  strict: true,
};
