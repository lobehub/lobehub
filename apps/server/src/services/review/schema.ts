import type { GenerateObjectSchema } from '@lobechat/model-runtime';
import { z } from 'zod';

/** Prompt versions are stamped into proposal metadata and test assertions. */
export const REVIEW_PROPOSAL_PROMPT_VERSION = 'review-proposal-v1';
export const REVIEW_CHECK_PROMPT_VERSION = 'review-check-v1';
export const REVIEW_SUGGESTION_PROMPT_VERSION = 'review-suggestion-v1';

/** At most 12 rules per model call; larger rule sets are chunked. */
export const REVIEW_CHECK_BATCH_SIZE = 12;
/** Document text cap for proposal prompts. */
export const REVIEW_PROPOSAL_MAX_CHARS = 24_000;
/** Document text cap for check / suggestion prompts. */
export const REVIEW_CHECK_MAX_CHARS = 24_000;

/** A rule draft the agent proposes. It is never persisted as-is (P3). */
export const ProposalDraftSchema = z.object({
  instruction: z.string().min(10).max(1200),
  rationale: z.string().min(8).max(600),
  severity: z.enum(['high', 'medium', 'low']).default('medium'),
  sourceHint: z
    .object({
      clauseLabel: z.string().max(120).optional(),
      kind: z.enum(['clause', 'pattern']),
      quote: z.string().max(400).optional(),
    })
    .nullable()
    .default(null),
  title: z.string().min(4).max(80),
});

export const ProposalResponseSchema = z.object({
  drafts: z.array(ProposalDraftSchema).max(8),
});

const CheckEvidenceSchema = z.object({
  clauseLabel: z.string().max(120).optional(),
  kind: z.enum(['supporting', 'violating', 'context']),
  quote: z.string().min(2).max(400),
});

export const CheckVerdictSchema = z.object({
  confidence: z.number().min(0).max(1),
  evidence: z.array(CheckEvidenceSchema).max(8).default([]),
  explanation: z.string().min(4).max(1200),
  uncertainReason: z
    .enum(['insufficient_evidence', 'ambiguous_wording', 'missing_attachment'])
    .optional(),
  verdict: z.enum(['passed', 'failed', 'uncertain']),
});

export const CheckResponseSchema = z.object({
  results: z
    .array(CheckVerdictSchema.extend({ ruleId: z.string().min(1) }))
    .max(REVIEW_CHECK_BATCH_SIZE * 5),
});

export const SuggestionResponseSchema = z.object({
  rationale: z.string().min(8).max(1200),
  replacementText: z.string().min(1).max(4000),
  targetQuote: z.string().min(2).max(400),
});

export type ProposalDraft = z.infer<typeof ProposalDraftSchema>;
export type CheckVerdict = z.infer<typeof CheckVerdictSchema>;

const pickMainSchema = (result: any, name: string): any => {
  if (result?.$defs?.[name]) return result.$defs[name];
  if (result?.definitions?.[name]) return result.definitions[name];
  return result;
};

/** Zod → the provider-facing JSON Schema used by `generateObject`. */
export const buildGenerateObjectSchema = (
  schema: z.ZodTypeAny,
  options: { description?: string; name: string; strict?: boolean },
): GenerateObjectSchema => {
  const fullSchema = z.toJSONSchema(schema, { target: 'draft-7' });
  const jsonSchema = pickMainSchema(fullSchema, options.name);
  if (jsonSchema?.type === 'object') jsonSchema.additionalProperties = false;

  return {
    description: options.description,
    name: options.name,
    schema: jsonSchema,
    strict: options.strict ?? true,
  };
};
