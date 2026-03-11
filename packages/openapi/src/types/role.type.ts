import { z } from 'zod';

import type { PermissionItem, RoleItem } from '@/database/schemas';

import type { IPaginationQuery, PaginationQueryResponse } from './common.type';
import { PaginationQuerySchema } from './common.type';

// ==================== Role Query Types ====================

/**
 * Role query parameters
 */
export type RolesListQuery = IPaginationQuery & {
  active?: boolean;
  system?: boolean;
};

export const RolesListQuerySchema = z
  .object({
    active: z
      .string()
      .transform((val) => val === 'true')
      .pipe(z.boolean())
      .nullish(),
    system: z
      .string()
      .transform((val) => val === 'true')
      .pipe(z.boolean())
      .nullish(),
  })
  .extend(PaginationQuerySchema.shape);

export type RolesListResponse = PaginationQueryResponse<{
  roles: RoleItem[];
}>;

// ==================== Role Permission Types ====================

export type RolePermissionsListQuery = IPaginationQuery;

export interface RolePermissionsListRequest extends IPaginationQuery {
  roleId: string;
}

export type RolePermissionsListResponse = PaginationQueryResponse<{
  permissions: Partial<PermissionItem>[];
}>;

// ==================== Role CRUD Types ====================

/**
 * Role creation request body
 */
export type CreateRoleRequest = {
  description?: string;
  displayName: string;
  isActive?: boolean;
  isSystem?: boolean;
  name: string;
};

export const CreateRoleRequestSchema = z.object({
  description: z.string().nullish(),
  displayName: z.string().min(1, '显示名称不能为空'),
  isActive: z.boolean().nullish().default(true),
  isSystem: z.boolean().nullish().default(false),
  name: z.string().min(1, '角色名称不能为空'),
});

/**
 * Role update request body
 */
export type UpdateRoleRequest = Partial<CreateRoleRequest>;

export const UpdateRoleRequestSchema = CreateRoleRequestSchema.partial();

/**
 * Role permissions update request
 */
export type UpdateRolePermissionsRequest = {
  grant?: string[];
  revoke?: string[];
};

export const UpdateRolePermissionsRequestSchema = z
  .object({
    grant: z.array(z.string().min(1, '权限 ID 不能为空')).nullish(),
    revoke: z.array(z.string().min(1, '权限 ID 不能为空')).nullish(),
  })
  .refine(
    (data) => {
      const grantLength = data.grant?.length ?? 0;
      const revokeLength = data.revoke?.length ?? 0;
      return grantLength > 0 || revokeLength > 0;
    },
    {
      message: '至少需要提供一个要授予或撤销的权限 ID',
    },
  );

// ==================== Common Schemas ====================

export const RoleIdParamSchema = z.object({
  id: z.string().min(1, '角色 ID 不正确'),
});

export { PaginationQuerySchema as RolePermissionsListQuerySchema } from './common.type';
