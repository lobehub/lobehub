import { AiModelTypeSchema } from 'model-bank';
import { z } from 'zod';

import { example } from '../common/examples';

/**
 * Provider connectivity check, remote model listing, credential/config writes
 * and provider order — the REST twins of the tRPC `aiProvider` procedures
 * `checkProviderConnectivity`, `updateAiProviderConfig`, `updateAiProviderOrder`
 * and of `GET /webapi/models/{provider}`.
 */

// ==================== Connectivity check ====================

export const CheckProviderRequestSchema = z.object({
  model: z
    .string()
    .min(1)
    .max(150)
    .optional()
    .describe(
      "Model to send the probe to. Defaults to the provider's configured check model; providers that verify credentials without a chat call ignore it unless it is set.",
    ),
});

export type CheckProviderRequest = z.infer<typeof CheckProviderRequestSchema>;

export const CHECK_PROVIDER_REQUEST_EXAMPLE = example(CheckProviderRequestSchema, {
  model: 'gpt-4o-mini',
});

export const ProviderCheckResultSchema = z
  .object({
    /** Remaining balance or credits, when a credential check reports one. */
    balance: z.number().optional(),
    /** Why the check failed; absent when `ok`. */
    error: z.string().optional(),
    /** Runtime error type, e.g. `InvalidProviderAPIKey`, when the provider reported one. */
    errorType: z.string().optional(),
    /** The model the probe was sent to; absent for credential-only checks. */
    model: z.string().optional(),
    ok: z.boolean(),
    /** Upstream HTTP status of a failed probe, when the provider answered one. */
    status: z.number().int().optional(),
  })
  .strict()
  .meta({ id: 'ProviderCheckResult' });

export type ProviderCheckResult = z.infer<typeof ProviderCheckResultSchema>;

// ==================== Remote models ====================

const jsonRecord = z.record(z.string(), z.unknown());

/** One model as the provider's own model-list endpoint reports it. */
export const RemoteModelSchema = z
  .object({
    contextWindowTokens: z.number().optional(),
    description: z.string().optional(),
    displayName: z.string().optional(),
    enabled: z.boolean().optional(),
    files: z.boolean().optional(),
    functionCall: z.boolean().optional(),
    id: z.string(),
    imageOutput: z.boolean().optional(),
    maxOutput: z.number().optional(),
    organization: z.string().optional(),
    parameters: jsonRecord.optional(),
    pricing: jsonRecord.optional(),
    reasoning: z.boolean().optional(),
    /** `YYYY-MM-DD`. */
    releasedAt: z.string().optional(),
    search: z.boolean().optional(),
    settings: jsonRecord.optional(),
    type: AiModelTypeSchema.optional(),
    video: z.boolean().optional(),
    vision: z.boolean().optional(),
  })
  .strict()
  .meta({ id: 'RemoteModel' });

export type RemoteModel = z.infer<typeof RemoteModelSchema>;

export const RemoteModelListSchema = z
  .object({
    models: z.array(RemoteModelSchema),
    providerId: z.string(),
  })
  .strict()
  .meta({ id: 'RemoteModelList' });

export type RemoteModelList = z.infer<typeof RemoteModelListSchema>;

// ==================== Config / order ====================

export const UpdateProviderConfigRequestSchema = z.object({
  checkModel: z.string().min(1).max(150).optional(),
  config: z
    .object({
      enableResponseApi: z
        .boolean()
        .optional()
        .describe(
          'OpenAI-compatible providers: call the Responses API instead of Chat Completions.',
        ),
    })
    .strict()
    .optional(),
  fetchOnClient: z.boolean().nullish(),
  keyVaults: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Credential fields (e.g. `apiKey`, `baseURL`). Merged into the stored, encrypted vault: omitted fields keep their saved value. Never returned.',
    ),
});

export type UpdateProviderConfigRequest = z.infer<typeof UpdateProviderConfigRequestSchema>;

export const UPDATE_PROVIDER_CONFIG_REQUEST_EXAMPLE = example(UpdateProviderConfigRequestSchema, {
  checkModel: 'gpt-4o-mini',
  keyVaults: { apiKey: 'sk-...', baseURL: 'https://api.openai.com/v1' },
});

export const ProviderConfigResultSchema = z
  .object({
    checkModel: z.string().nullable(),
    config: z.object({ enableResponseApi: z.boolean().optional() }).strict(),
    fetchOnClient: z.boolean().nullable(),
    /** Whether any credential is stored; the values themselves are never returned. */
    hasKeyVaults: z.boolean(),
    id: z.string(),
    /** Names of the stored credential fields, e.g. `["apiKey", "baseURL"]`. */
    keyVaultFields: z.array(z.string()),
  })
  .strict()
  .meta({ id: 'ProviderConfigResult' });

export type ProviderConfigResult = z.infer<typeof ProviderConfigResultSchema>;

export const ReorderProvidersRequestSchema = z.object({
  sortMap: z
    .array(z.object({ id: z.string().min(1).max(64), sort: z.number().int() }))
    .min(1)
    .max(500),
});

export type ReorderProvidersRequest = z.infer<typeof ReorderProvidersRequestSchema>;

export const REORDER_PROVIDERS_REQUEST_EXAMPLE = example(ReorderProvidersRequestSchema, {
  sortMap: [
    { id: 'openai', sort: 0 },
    { id: 'anthropic', sort: 1 },
  ],
});

export const ReorderProvidersResultSchema = z
  .object({
    /** Provider ids in their new order. */
    providerIds: z.array(z.string()),
  })
  .strict()
  .meta({ id: 'ReorderProvidersResult' });
