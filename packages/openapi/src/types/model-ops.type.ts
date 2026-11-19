import { AiModelReasoningConfigSchema, AiModelTypeSchema } from 'model-bank';
import { z } from 'zod';

import { example } from '../common/examples';

/**
 * Bulk model operations, model order and per-user reasoning defaults. Shapes
 * mirror the tRPC `aiModel` procedures these endpoints reuse
 * (`batchToggleAiModels`, `batchUpdateAiModels`, `updateAiModelOrder`,
 * `get/updateAiModelReasoningConfig`).
 */

const ProviderIdSchema = z
  .string()
  .min(1, 'Provider ID cannot be empty')
  .max(64, 'Provider ID cannot exceed 64 characters');

const ModelIdSchema = z
  .string()
  .min(1, 'Model ID cannot be empty')
  .max(150, 'Model ID cannot exceed 150 characters');

/** At most this many models per bulk call, so one request stays one bounded upsert. */
const MAX_BATCH_MODELS = 500;

const jsonRecord = z.record(z.string(), z.unknown());

/**
 * Capability flags as `GET /providers/{id}/remote-models` returns them, at the
 * top level of each card. An upsert folds them into `abilities`, like the
 * in-app remote import, so a fetched list can be sent back unchanged.
 */
export const MODEL_ABILITY_FLAGS = [
  'files',
  'functionCall',
  'imageOutput',
  'reasoning',
  'search',
  'video',
  'vision',
] as const;

const abilityFlagShape = Object.fromEntries(
  MODEL_ABILITY_FLAGS.map((flag) => [
    flag,
    z.boolean().optional().describe(`Folded into \`abilities.${flag}\`.`),
  ]),
) as Record<(typeof MODEL_ABILITY_FLAGS)[number], z.ZodOptional<z.ZodBoolean>>;

/** One model written by an `upsert` batch — the provider model-list item shape. */
export const BatchModelItemSchema = z.object({
  ...abilityFlagShape,
  abilities: jsonRecord
    .optional()
    .describe('Capability flags, e.g. `{ "vision": true }`. Wins over a top-level flag.'),
  config: jsonRecord.optional(),
  contextWindowTokens: z.number().int().nonnegative().optional(),
  description: z.string().optional(),
  displayName: z.string().optional(),
  enabled: z.boolean().optional(),
  id: ModelIdSchema,
  organization: z.string().optional(),
  parameters: jsonRecord.optional(),
  pricing: jsonRecord.optional(),
  releasedAt: z.string().optional().describe('`YYYY-MM-DD`.'),
  settings: jsonRecord.optional(),
  sort: z.number().int().optional(),
  source: z.enum(['remote', 'custom', 'builtin']).optional(),
  type: AiModelTypeSchema.default('chat'),
});

export type BatchModelItem = z.infer<typeof BatchModelItemSchema>;

export const BatchModelsRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('enable').describe('Enable every listed model.'),
    modelIds: z.array(ModelIdSchema).min(1).max(MAX_BATCH_MODELS),
    providerId: ProviderIdSchema,
  }),
  z.object({
    action: z.literal('disable').describe('Disable every listed model.'),
    modelIds: z.array(ModelIdSchema).min(1).max(MAX_BATCH_MODELS),
    providerId: ProviderIdSchema,
  }),
  z.object({
    action: z
      .literal('upsert')
      .describe(
        'Create or update the listed models under the provider. Use `source: "remote"` to store a list fetched from `GET /providers/{id}/remote-models`.',
      ),
    models: z.array(BatchModelItemSchema).min(1).max(MAX_BATCH_MODELS),
    providerId: ProviderIdSchema,
  }),
]);

export const BATCH_MODELS_REQUEST_EXAMPLE = example(BatchModelsRequestSchema, {
  action: 'enable',
  modelIds: ['gpt-4o', 'gpt-4o-mini'],
  providerId: 'openai',
});

export type BatchModelsRequest = z.infer<typeof BatchModelsRequestSchema>;

export const BatchModelsResultSchema = z
  .object({
    action: z.enum(['enable', 'disable', 'upsert']),
    /** The distinct model ids the batch wrote. */
    modelIds: z.array(z.string()),
    providerId: z.string(),
  })
  .strict()
  .meta({ id: 'BatchModelsResult' });

export type BatchModelsResult = z.infer<typeof BatchModelsResultSchema>;

export const ReorderModelsRequestSchema = z.object({
  providerId: ProviderIdSchema,
  sortMap: z
    .array(
      z.object({
        id: ModelIdSchema,
        sort: z.number().int(),
        type: AiModelTypeSchema.optional(),
      }),
    )
    .min(1)
    .max(MAX_BATCH_MODELS),
});

export const REORDER_MODELS_REQUEST_EXAMPLE = example(ReorderModelsRequestSchema, {
  providerId: 'openai',
  sortMap: [
    { id: 'gpt-4o', sort: 0 },
    { id: 'gpt-4o-mini', sort: 1 },
  ],
});

export type ReorderModelsRequest = z.infer<typeof ReorderModelsRequestSchema>;

export const ReorderModelsResultSchema = z
  .object({
    /** Model ids in their new order. */
    modelIds: z.array(z.string()),
    providerId: z.string(),
  })
  .strict()
  .meta({ id: 'ReorderModelsResult' });

/**
 * The caller's default reasoning parameters for one model instance. Every
 * field is optional; which ones a model honours depends on the model.
 */
export const ModelReasoningConfigSchema = AiModelReasoningConfigSchema.strict().meta({
  id: 'ModelReasoningConfig',
});

export type ModelReasoningConfig = z.infer<typeof ModelReasoningConfigSchema>;

export const ModelReasoningConfigResultSchema = z
  .object({
    /** `{}` when the caller has saved no default for this model. */
    config: ModelReasoningConfigSchema,
    modelId: z.string(),
    providerId: z.string(),
  })
  .strict()
  .meta({ id: 'ModelReasoningConfigResult' });

export type ModelReasoningConfigResult = z.infer<typeof ModelReasoningConfigResultSchema>;

export const REASONING_CONFIG_REQUEST_EXAMPLE = example(ModelReasoningConfigSchema, {
  reasoningEffort: 'high',
});
