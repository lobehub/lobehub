import { z } from 'zod';

import type { PermissionItem } from '@/database/schemas';

import type { IPaginationQuery, PaginationQueryResponse } from './common.type';
import { PaginationQuerySchema } from './common.type';

// ==================== Permission Query Types ====================

/**
 * Permission list query parameters
 */
export type PermissionsListQuery = IPaginationQuery & {
  active?: boolean;
  category?: string;
};

export const PermissionsListQuerySchema = z
  .object({
    active: z
      .string()
      .transform((val) => val === 'true')
      .pipe(z.boolean())
      .nullish(),
    category: z.string().min(1).nullish(),
  })
  .extend(PaginationQuerySchema.shape);

export type PermissionsListResponse = PaginationQueryResponse<{
  permissions: PermissionItem[];
}>;

// ==================== Permission CRUD Types ====================

/**
 * Create permission request body
 */
export type CreatePermissionRequest = {
  category: string;
  code: string;
  description?: string | null;
  isActive?: boolean;
  name: string;
};

export const CreatePermissionRequestSchema = z.object({
  category: z.string().min(1, 'Category is required'),
  code: z.string().min(1, 'Permission code is required'),
  description: z.string().nullish(),
  isActive: z.boolean().nullish().default(true),
  name: z.string().min(1, 'Permission name is required'),
});

/**
 * Update permission request body
 */
export type UpdatePermissionRequest = Partial<CreatePermissionRequest>;

export const UpdatePermissionRequestSchema = CreatePermissionRequestSchema.partial();

// ==================== Common Schemas ====================

export const PermissionIdParamSchema = z.object({
  id: z.string().length(16, 'Permission ID must be 16 characters'),
});
