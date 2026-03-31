import { z } from 'zod';

import type { RoleItem, UserItem, UserRoleItem } from '@/database/schemas';

import type { IPaginationQuery, PaginationQueryResponse } from './common.type';

// ==================== User Base Types ====================

/**
 * Get user list request parameters (optional pagination)
 */
export interface GetUsersRequest {
  page?: number;
  pageSize?: number;
}

/**
 * Extended user info type including role information
 */
export type UserWithRoles = UserItem & {
  messageCount?: number;
  roles?: RoleItem[];
};

// ==================== User CRUD Types ====================

/**
 * Create user request parameters
 */
export interface CreateUserRequest {
  avatar?: string;
  email: string;
  firstName?: string;
  fullName?: string;
  id?: string;
  lastName?: string;
  phone?: string;
  roleIds?: string[];
  username?: string;
}

export const CreateUserRequestSchema = z.object({
  avatar: z.string().nullish(),
  email: z.string().email('邮箱格式不正确').nullish(),
  firstName: z.string().nullish(),
  fullName: z.string().nullish(),
  id: z.string().nullish(),
  lastName: z.string().nullish(),
  phone: z.string().nullish(),
  roleIds: z.array(z.string().min(1, '角色ID不能为空')).nullish(),
  username: z.string().min(1, '用户名不能为空').nullish(),
});

/**
 * Update user request parameters
 */
export interface UpdateUserRequest {
  avatar?: string;
  email?: string;
  firstName?: string;
  fullName?: string;
  isOnboarded?: boolean;
  lastName?: string;
  phone?: string;
  preference?: any;
  roleIds?: string[];
  username?: string;
}

/**
 * Update user request validation schema
 */
export const UpdateUserRequestSchema = z.object({
  avatar: z.string().nullish(),
  email: z.string().email('邮箱格式不正确').nullish(),
  firstName: z.string().nullish(),
  fullName: z.string().nullish(),
  isOnboarded: z.boolean().nullish(),
  lastName: z.string().nullish(),
  phone: z.string().nullish(),
  preference: z.any().nullish(),
  roleIds: z.array(z.string().min(1, '角色ID不能为空')).nullish(),
  username: z.string().min(1, '用户名不能为空').nullish(),
});

// ==================== User Search Types ====================

export { PaginationQuerySchema as UserSearchRequestSchema } from '.';

export type UserListRequest = IPaginationQuery;

export type UserListResponse = PaginationQueryResponse<{
  users: UserWithRoles[];
}>;

// ==================== User Role Management Types ====================

/**
 * Request for adding a single role
 */
export interface AddRoleRequest {
  expiresAt?: string; // Expiry time in ISO 8601 format
  roleId: string;
}

export const AddRoleRequestSchema = z.object({
  expiresAt: z.string().datetime('过期时间必须是有效的ISO 8601格式').nullish(),
  roleId: z.string().min(1, '角色ID不能为空'),
});

/**
 * Update user roles request parameters
 */
export interface UpdateUserRolesRequest {
  addRoles?: AddRoleRequest[]; // Roles to add
  removeRoles?: string[]; // Role IDs to remove
}

export const UpdateUserRolesRequestSchema = z
  .object({
    addRoles: z.array(AddRoleRequestSchema).nullish(),
    removeRoles: z.array(z.string().min(1, '角色ID不能为空')).nullish(),
  })
  .refine(
    (data) => {
      // At least one operation (add or remove) must be specified
      return (
        (data.addRoles && data.addRoles.length > 0) ||
        (data.removeRoles && data.removeRoles.length > 0)
      );
    },
    {
      message: '必须指定要添加或移除的角色',
    },
  )
  .refine(
    (data) => {
      // Check that there are no overlapping roles between add and remove lists
      if (!data.addRoles || !data.removeRoles) return true;

      const addRoleIds = data.addRoles.map((r) => r.roleId);
      const removeRoleIds = data.removeRoles;

      const overlap = addRoleIds.filter((id) => removeRoleIds.includes(id));
      return overlap.length === 0;
    },
    {
      message: '不能同时添加和移除同一个角色',
    },
  );

/**
 * User role detail, including role info and association info
 */
export interface UserRoleDetail extends UserRoleItem {
  role: RoleItem;
}

/**
 * User role operation response
 */
export type UserRolesResponse = {
  expiresAt?: Date | null;
  roleDisplayName: string;
  roleId: string;
  roleName: string;
}[];

/**
 * User role operation result
 */
export interface UserRoleOperationResult {
  added: number;
  errors?: string[];
  removed: number;
}

// ==================== Common Schemas ====================

export const UserIdParamSchema = z.object({
  id: z.string().min(1, '用户ID不能为空'),
});
