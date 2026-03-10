import { z } from 'zod';

import type { AiProviderSelectItem } from '@/database/schemas';
import type { AiProviderConfig, AiProviderSettings } from '@/types/aiProvider';

import type { IPaginationQuery, PaginationQueryResponse } from './common.type';
import { PaginationQuerySchema } from './common.type';

// ==================== Provider Common Types ====================

export type ProviderKeyVaults = Record<string, string | undefined>;

export type ProviderDetailResponse = Omit<AiProviderSelectItem, 'keyVaults'> & {
  keyVaults?: ProviderKeyVaults;
};

export type GetProvidersResponse = PaginationQueryResponse<{
  providers: ProviderDetailResponse[];
}>;

export interface GetProviderDetailRequest {
  id: string;
}

export interface DeleteProviderRequest {
  id: string;
}

// ==================== Provider Query Types ====================

export interface ProviderListQuery extends IPaginationQuery {
  enabled?: boolean;
}

const EnabledQuerySchema = z.preprocess((val) => {
  if (typeof val === 'boolean') return val;
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'string') {
    const normalized = val.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }

  return undefined;
}, z.boolean().optional());

export const ProviderListQuerySchema = PaginationQuerySchema.extend({
  enabled: EnabledQuerySchema,
}).passthrough();

export type ProviderListQuerySchemaType = z.infer<typeof ProviderListQuerySchema>;

// ==================== Provider Mutation Schemas ====================

const ProviderPayloadBaseSchema = z.object({
  checkModel: z.string().nullable().optional(),
  config: z.record(z.unknown()).optional(),
  description: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  fetchOnClient: z.boolean().nullable().optional(),
  keyVaults: z.record(z.string()).optional(),
  logo: z.string().nullable().optional(),
  name: z.string().min(1, 'Provider 名称不能为空').nullable().optional(),
  settings: z.record(z.unknown()).optional(),
  sort: z.number().int().nullable().optional(),
  source: z.enum(['builtin', 'custom']).optional(),
});

export const CreateProviderRequestSchema = ProviderPayloadBaseSchema.extend({
  id: z.string().min(1, 'Provider ID 不能为空'),
});

export const UpdateProviderRequestSchema = ProviderPayloadBaseSchema.extend({
  keyVaults: z.record(z.string()).nullable().optional(),
});

export type CreateProviderRequestSchemaType = z.infer<typeof CreateProviderRequestSchema>;
export type UpdateProviderRequestSchemaType = z.infer<typeof UpdateProviderRequestSchema>;

export interface CreateProviderRequest extends Omit<
  CreateProviderRequestSchemaType,
  'config' | 'settings' | 'keyVaults'
> {
  config?: AiProviderConfig;
  keyVaults?: ProviderKeyVaults;
  settings?: AiProviderSettings;
}

export type UpdateProviderRequestBody = Omit<
  UpdateProviderRequestSchemaType,
  'config' | 'settings' | 'keyVaults'
> & {
  config?: AiProviderConfig;
  keyVaults?: ProviderKeyVaults | null;
  settings?: AiProviderSettings;
};

export interface UpdateProviderRequest extends UpdateProviderRequestBody {
  id: string;
}

export type CreateProviderResponse = ProviderDetailResponse;
export type UpdateProviderResponse = ProviderDetailResponse;

// ==================== Provider Param Schemas ====================

export const ProviderIdParamSchema = z.object({
  id: z.string().min(1, 'Provider ID 不能为空').max(64, 'Provider ID 不能超过 64 个字符'),
});

export type ProviderIdParam = z.infer<typeof ProviderIdParamSchema>;
