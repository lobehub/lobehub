import type { GenerateObjectSchema } from '@lobechat/model-runtime';
import { z } from 'zod';

// ============================================
// Plan generation — AI proposes additional check criteria for a run
// ============================================

const verifierTypeEnum = ['program', 'agent', 'llm'] as const;
const onFailEnum = ['manual', 'auto_repair'] as const;

/** Lenient parse of the AI plan-gen output; the service filters/normalizes. */
export const RawGeneratedCriteriaSchema = z.object({
  criteria: z.array(
    z.object({
      description: z.string().optional(),
      instruction: z.string().optional(),
      onFail: z.enum(onFailEnum).optional(),
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
            required: { type: 'boolean' },
            title: { maxLength: 80, minLength: 1, type: 'string' },
            verifierType: { enum: [...verifierTypeEnum], type: 'string' },
          },
          required: ['title', 'description', 'instruction', 'verifierType', 'required', 'onFail'],
          type: 'object',
        },
        maxItems: 6,
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
