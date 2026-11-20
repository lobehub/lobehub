import { z } from 'zod';

import type { AiProviderConfig, AiProviderSettings } from '@/types/aiProvider';

import { pageInfoShape, totalShape } from '../helpers/pagination';
import type { PublicProvider } from '../helpers/public-fields';
import type { IPaginationQuery, PaginationQueryResponse } from './common.type';
import { dateTimeSchema, jsonObjectSchema, PaginationQuerySchema } from './common.type';

// ==================== Provider Common Types ====================

export type ProviderKeyVaults = Record<string, string | undefined>;

export type ProviderDetailResponse = PublicProvider;

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
  checkModel: z.string().nullish(),
  config: z.record(z.string(), z.unknown()).optional(),
  description: z.string().nullish(),
  enabled: z.boolean().optional(),
  fetchOnClient: z.boolean().nullish(),
  keyVaults: z.record(z.string(), z.string()).optional(),
  logo: z.string().nullish(),
  name: z.string().min(1, 'Provider name cannot be empty').nullish(),
  settings: z.record(z.string(), z.unknown()).optional(),
  sort: z.number().int().nullish(),
  source: z.enum(['builtin', 'custom']).optional(),
});

export const CreateProviderRequestSchema = ProviderPayloadBaseSchema.extend({
  id: z.string().min(1, 'Provider ID cannot be empty'),
});

export const UpdateProviderRequestSchema = ProviderPayloadBaseSchema.extend({
  keyVaults: z.record(z.string(), z.string()).nullish(),
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
  id: z
    .string()
    .min(1, 'Provider ID cannot be empty')
    .max(64, 'Provider ID cannot exceed 64 characters'),
});

export type ProviderIdParam = z.infer<typeof ProviderIdParamSchema>;

// ==================== Response Schemas ====================

/**
 * A provider row projected through `PUBLIC_PROVIDER_FIELDS`; every field is
 * always present. The encrypted key vault is never part of the response.
 */
export const ProviderSchema = z
  .object({
    checkModel: z.string().nullable(),
    config: jsonObjectSchema.nullable(),
    createdAt: dateTimeSchema,
    description: z.string().nullable(),
    enabled: z.boolean().nullable(),
    fetchOnClient: z.boolean().nullable(),
    id: z.string(),
    logo: z.string().nullable(),
    name: z.string().nullable(),
    settings: jsonObjectSchema.nullable(),
    sort: z.number().int().nullable(),
    source: z.enum(['builtin', 'custom']).nullable(),
    updatedAt: dateTimeSchema,
  } satisfies Record<keyof PublicProvider, z.ZodType>)
  .strict()
  .meta({ id: 'Provider' });

export const ProviderListSchema = z
  .object({ ...pageInfoShape, providers: z.array(ProviderSchema), ...totalShape })
  .strict();
