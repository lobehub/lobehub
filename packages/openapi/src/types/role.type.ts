import { z } from 'zod';

import { pageInfoShape, totalShape } from '../helpers/pagination';
import type { PublicPermission, PublicRole } from '../helpers/public-fields';
import type { IPaginationQuery, PaginationQueryResponse } from './common.type';
import { dateTimeSchema, PaginationQuerySchema } from './common.type';

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
  roles: PublicRole[];
}>;

// ==================== Role Permission Types ====================

export type RolePermissionsListQuery = IPaginationQuery;

export interface RolePermissionsListRequest extends IPaginationQuery {
  roleId: string;
}

export type RolePermissionsListResponse = PaginationQueryResponse<{
  permissions: Partial<PublicPermission>[];
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
  displayName: z.string().min(1, 'Display name cannot be empty'),
  isActive: z.boolean().nullish().default(true),
  isSystem: z.boolean().nullish().default(false),
  name: z.string().min(1, 'Role name cannot be empty'),
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
    grant: z.array(z.string().min(1, 'Permission ID cannot be empty')).nullish(),
    revoke: z.array(z.string().min(1, 'Permission ID cannot be empty')).nullish(),
  })
  .refine(
    (data) => {
      const grantLength = data.grant?.length ?? 0;
      const revokeLength = data.revoke?.length ?? 0;
      return grantLength > 0 || revokeLength > 0;
    },
    {
      message: 'At least one permission ID to grant or revoke must be provided',
    },
  );

// ==================== Common Schemas ====================

export const RoleIdParamSchema = z.object({
  id: z.string().min(1, 'Invalid role ID'),
});

export { PaginationQuerySchema as RolePermissionsListQuerySchema } from './common.type';

// ==================== Response Schemas ====================

/** `PUBLIC_ROLE_FIELDS` projection of an `rbac_roles` row. */
export const RoleSchema = z
  .object({
    createdAt: dateTimeSchema,
    description: z.string().nullable(),
    displayName: z.string(),
    id: z.string(),
    isActive: z.boolean(),
    isSystem: z.boolean(),
    name: z.string(),
    updatedAt: dateTimeSchema,
  })
  .strict()
  .meta({ id: 'Role' });

export const RoleListSchema = z
  .object({ ...pageInfoShape, roles: z.array(RoleSchema), ...totalShape })
  .strict()
  .meta({ id: 'RoleList' });

/** The permission columns `GET /roles/:id/permissions` selects (no timestamps). */
export const RolePermissionSchema = z
  .object({
    category: z.string(),
    code: z.string(),
    description: z.string().nullable(),
    id: z.string(),
    isActive: z.boolean(),
    name: z.string(),
  })
  .strict()
  .meta({ id: 'RolePermission' });

export const RolePermissionListSchema = z
  .object({
    ...pageInfoShape,
    permissions: z.array(RolePermissionSchema),
    ...totalShape,
  })
  .strict()
  .meta({ id: 'RolePermissionList' });

export const RolePermissionsUpdateResultSchema = z
  .object({
    /** Mappings newly inserted (already-granted ids are not counted). */
    granted: z.number().int().min(0),
    /** Mappings actually removed. */
    revoked: z.number().int().min(0),
    roleId: z.string(),
  })
  .strict()
  .meta({ id: 'RolePermissionsUpdateResult' });
