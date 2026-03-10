import { z } from 'zod';

import type { AiModelSelectItem } from '@/database/schemas';

import type { IPaginationQuery, PaginationQueryResponse } from './common.type';
import { PaginationQuerySchema } from './common.type';

// ==================== Model List Query Types ====================

const MODEL_TYPES = [
  'chat',
  'embedding',
  'tts',
  'stt',
  'image',
  'text2video',
  'text2music',
  'realtime',
] as const;

/**
 * Model list query parameters
 */
export interface ModelsListQuery extends IPaginationQuery {
  enabled?: boolean;
  provider?: string;
  type?: (typeof MODEL_TYPES)[number];
}

export const ModelsListQuerySchema = PaginationQuerySchema.extend({
  enabled: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean())
    .nullish(),
  provider: z.string().min(1).max(64).nullish(),
  type: z.enum(MODEL_TYPES).nullish(),
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
  displayName: z.string().min(1, '模型显示名称不能为空'),
  enabled: z.boolean().nullish(),
  organization: z.string().nullish(),
  parameters: z.record(z.unknown()).nullish(),
  pricing: z.record(z.unknown()).nullish(),
  releasedAt: z.string().nullish(),
  sort: z.number().int().nullish(),
  source: z.enum(['remote', 'custom', 'builtin']).nullish(),
  type: z
    .enum(['chat', 'embedding', 'tts', 'stt', 'image', 'text2video', 'text2music', 'realtime'])
    .nullish(),
});

export const CreateModelRequestSchema = ModelPayloadBaseSchema.extend({
  displayName: z.string().min(1, '模型显示名称不能为空'),
  id: z.string().min(1, '模型 ID 不能为空').max(150, '模型 ID 不能超过 150 个字符'),
  providerId: z.string().min(1, 'Provider ID 不能为空').max(64, 'Provider ID 不能超过 64 个字符'),
});

export const UpdateModelRequestSchema = ModelPayloadBaseSchema.partial();

export type CreateModelRequest = z.infer<typeof CreateModelRequestSchema>;
export type UpdateModelRequest = z.infer<typeof UpdateModelRequestSchema>;

export const ModelIdParamSchema = z.object({
  modelId: z.string().min(1, '模型 ID 不能为空').max(150, '模型 ID 不能超过 150 个字符'),
  providerId: z.string().min(1, 'Provider ID 不能为空').max(64, 'Provider ID 不能超过 64 个字符'),
});
