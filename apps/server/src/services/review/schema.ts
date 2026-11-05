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

/** Widen one property node so the model can answer it with `null`. */
const makeNullable = (node: any) => {
  if (!node || typeof node !== 'object') return;

  // JSON Schema applies `type` and `enum` together, so widening `type` alone
  // still rejects `null` while `enum` lists only the value union — the provider
  // would have to invent an enum member for a field that should be absent.
  if (Array.isArray(node.enum) && !node.enum.includes(null)) node.enum = [...node.enum, null];

  if (Array.isArray(node.type)) {
    if (!node.type.includes('null')) node.type.push('null');
    return;
  }
  if (typeof node.type === 'string') {
    node.type = [node.type, 'null'];
    return;
  }
  if (Array.isArray(node.anyOf) && !node.anyOf.some((branch: any) => branch?.type === 'null')) {
    node.anyOf.push({ type: 'null' });
  }
};

/** Dot-joined property names; array indices are collapsed, so `items` inherits
 * the path of the property that holds the array. */
const pathKey = (path: string[], key: string) => [...path, key].join('.');

/**
 * OpenAI strict structured output requires every property to be listed in
 * `required` and every object to set `additionalProperties: false`, so optional
 * data has to be expressed as `null` instead of an absent key. Zod only puts
 * truly required keys into `required`, and the OpenAI runtime forwards the
 * schema untouched — without this pass an optional field rejects the whole
 * request. See https://developers.openai.com/api/docs/guides/structured-outputs#all-fields-must-be-required
 *
 * Paths widened here are collected so `dropNulls` can undo exactly those and
 * nothing else.
 */
const normalizeStrictNode = (
  node: any,
  path: string[] = [],
  nullable: Set<string> = new Set(),
): Set<string> => {
  if (!node || typeof node !== 'object') return nullable;
  if (Array.isArray(node)) {
    for (const item of node) normalizeStrictNode(item, path, nullable);
    return nullable;
  }

  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    for (const branch of Array.isArray(node[key]) ? node[key] : []) {
      normalizeStrictNode(branch, path, nullable);
    }
  }
  if (node.items) normalizeStrictNode(node.items, path, nullable);
  for (const key of ['$defs', 'definitions']) {
    for (const definition of Object.values<any>(node[key] ?? {})) {
      normalizeStrictNode(definition, path, nullable);
    }
  }

  if (!node.properties) return nullable;

  const required: string[] = Array.isArray(node.required) ? [...node.required] : [];
  for (const [key, property] of Object.entries<any>(node.properties)) {
    const childPath = [...path, key];
    if (!required.includes(key)) {
      makeNullable(property);
      nullable.add(childPath.join('.'));
    }
    normalizeStrictNode(property, childPath, nullable);
  }
  node.required = Object.keys(node.properties);
  node.additionalProperties = false;

  return nullable;
};

const EMPTY_PATHS: ReadonlySet<string> = new Set();

const nullablePathCache = new WeakMap<z.ZodTypeAny, ReadonlySet<string>>();

/**
 * The property paths (dot-joined, array indices collapsed) that strict
 * normalization widened to `null` for a given Zod schema.
 */
export const strictNullablePaths = (schema: z.ZodTypeAny): ReadonlySet<string> => {
  const cached = nullablePathCache.get(schema);
  if (cached) return cached;

  const jsonSchema = pickMainSchema(z.toJSONSchema(schema, { target: 'draft-7' }), 'root');
  const paths: ReadonlySet<string> = normalizeStrictNode(jsonSchema);
  nullablePathCache.set(schema, paths);

  return paths;
};

/**
 * Strict mode answers absent optional fields with `null`, while Zod `.optional()`
 * only accepts `undefined`. Unset the nulls before validating so the Zod schemas
 * stay the single source of truth — but only where strict normalization widened
 * the field. A `null` in a required property (say `severity` or `evidence`)
 * still reaches Zod and is rejected instead of silently falling back to a default.
 */
export const dropNulls = <T>(
  value: T,
  nullablePaths: ReadonlySet<string> = EMPTY_PATHS,
  path: string[] = [],
): T => {
  if (Array.isArray(value)) {
    return value.map((item) => dropNulls(item, nullablePaths, path)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === null && nullablePaths.has(pathKey(path, key))) continue;
      result[key] = dropNulls(item, nullablePaths, [...path, key]);
    }
    return result as T;
  }
  return value;
};

/** Zod → the provider-facing JSON Schema used by `generateObject`. */
export const buildGenerateObjectSchema = (
  schema: z.ZodTypeAny,
  options: { description?: string; name: string; strict?: boolean },
): GenerateObjectSchema => {
  const fullSchema = z.toJSONSchema(schema, { target: 'draft-7' });
  const jsonSchema = pickMainSchema(fullSchema, options.name);
  if (options.strict ?? true) normalizeStrictNode(jsonSchema);

  return {
    description: options.description,
    name: options.name,
    schema: jsonSchema,
    strict: options.strict ?? true,
  };
};
