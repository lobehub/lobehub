import { z } from 'zod';

import type { AiModelSelectItem } from '@/database/schemas';

import type { IPaginationQuery, PaginationQueryResponse } from './common.type';
import { PaginationQuerySchema } from './common.type';

// ==================== Model List Query Types ====================

const MODEL_TYPES = [
  'chat',
  'embedding',
  'tts',
  'asr',
  'image',
  'text2video',
  'text2music',
  'realtime',
] as const;

// `stt` was renamed to the standard `asr`. It is still accepted on input as a
// deprecated alias (so existing API clients don't break) and normalized to
// `asr` in the service layer; it is never emitted in responses.
const MODEL_TYPE_INPUTS = [...MODEL_TYPES, 'stt'] as const;

/**
 * Model list query parameters
 */
export interface ModelsListQuery extends IPaginationQuery {
  enabled?: boolean;
  provider?: string;
  type?: (typeof MODEL_TYPE_INPUTS)[number];
}

export const ModelsListQuerySchema = PaginationQuerySchema.extend({
  enabled: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean())
    .nullish(),
  provider: z.string().min(1).max(64).nullish(),
  type: z.enum(MODEL_TYPE_INPUTS).nullish(),
});

// ==================== Model Response Types ====================

export type GetModelsResponse = PaginationQueryResponse<{
  models?: AiModelSelectItem[];
}>;

// ==================== Model Detail / Mutation Types ====================

export type ModelDetailResponse = AiModelSelectItem;

const ModelPayloadBaseSchema = z.object({
  abilities: z.record(z.unknown()).nullish(),
  config: z.record(z.unknown()).nullish(),
  contextWindowTokens: z.number().int().nullish(),
  description: z.string().nullish(),
  displayName: z.string().min(1, 'Model display name cannot be empty'),
  enabled: z.boolean().nullish(),
  organization: z.string().nullish(),
  parameters: z.record(z.unknown()).nullish(),
  pricing: z.record(z.unknown()).nullish(),
  releasedAt: z.string().nullish(),
  sort: z.number().int().nullish(),
  source: z.enum(['remote', 'custom', 'builtin']).nullish(),
  type: z.enum(MODEL_TYPE_INPUTS).nullish(),
});

export const CreateModelRequestSchema = ModelPayloadBaseSchema.extend({
  displayName: z.string().min(1, 'Model display name cannot be empty'),
  id: z
    .string()
    .min(1, 'Model ID cannot be empty')
    .max(150, 'Model ID cannot exceed 150 characters'),
  providerId: z
    .string()
    .min(1, 'Provider ID cannot be empty')
    .max(64, 'Provider ID cannot exceed 64 characters'),
});

export const UpdateModelRequestSchema = ModelPayloadBaseSchema.partial();

export type CreateModelRequest = z.infer<typeof CreateModelRequestSchema>;
export type UpdateModelRequest = z.infer<typeof UpdateModelRequestSchema>;

export const ModelIdParamSchema = z.object({
  modelId: z
    .string()
    .min(1, 'Model ID cannot be empty')
    .max(150, 'Model ID cannot exceed 150 characters'),
  providerId: z
    .string()
    .min(1, 'Provider ID cannot be empty')
    .max(64, 'Provider ID cannot exceed 64 characters'),
});
