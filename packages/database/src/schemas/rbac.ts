import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { createNanoId } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

// Roles table
export const roles = pgTable(
  'rbac_roles',
  {
    id: text('id')
      .$defaultFn(() => createNanoId(16)())
      .notNull()
      .primaryKey(),

    name: text('name').notNull(), // Role name, e.g.: admin, user, guest, workspace_owner
    displayName: text('display_name').notNull(), // Display name
    description: text('description'), // Role description
    isSystem: boolean('is_system').default(false).notNull(), // Whether it's a built-in role
    isActive: boolean('is_active').default(true).notNull(), // Whether it's active
    metadata: jsonb('metadata').default({}), // Role metadata
    // null = global / system-level role (e.g. super_admin). Non-null = role
    // scoped to a single workspace; every workspace gets its own copies of the
    // built-in workspace_owner / workspace_member / workspace_viewer roles.
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    ...timestamps,
  },
  (self) => [
    // Role name is unique *within a scope*: globally for system roles, per
    // workspace for workspace roles. Use COALESCE so postgres treats nulls as
    // a single "global" bucket instead of always-distinct.
    uniqueIndex('rbac_roles_name_scope_unique').on(
      self.name,
      sql`COALESCE(${self.workspaceId}, '')`,
    ),
    index('rbac_roles_workspace_id_idx').on(self.workspaceId),
  ],
);

export type NewRole = typeof roles.$inferInsert;
export type RoleItem = typeof roles.$inferSelect;

// Permissions table
export const permissions = pgTable('rbac_permissions', {
  id: text('id')
    .$defaultFn(() => createNanoId(16)())
    .notNull()
    .primaryKey(),

  code: text('code').notNull().unique(), // Permission code, e.g.: chat:create, file:upload
  name: text('name').notNull(), // Permission name
  description: text('description'), // Permission description
  category: text('category').notNull(), // Category it belongs to, e.g.: message, knowledge_base, agent
  isActive: boolean('is_active').default(true).notNull(), // Whether it's active

  ...timestamps,
});

export type NewPermission = typeof permissions.$inferInsert;
export type PermissionItem = typeof permissions.$inferSelect;

// Role-permission association table
export const rolePermissions = pgTable(
  'rbac_role_permissions',
  {
    roleId: text('role_id')
      .references(() => roles.id, { onDelete: 'cascade' })
      .notNull(),
    permissionId: text('permission_id')
      .references(() => permissions.id, { onDelete: 'cascade' })
      .notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (self) => [
    primaryKey({ columns: [self.roleId, self.permissionId] }),
    index('rbac_role_permissions_role_id_idx').on(self.roleId),
    index('rbac_role_permissions_permission_id_idx').on(self.permissionId),
  ],
);

export type NewRolePermission = typeof rolePermissions.$inferInsert;
export type RolePermissionItem = typeof rolePermissions.$inferSelect;

// User-role association table
export const userRoles = pgTable(
  'rbac_user_roles',
  {
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    roleId: text('role_id')
      .references(() => roles.id, { onDelete: 'cascade' })
      .notNull(),
    // null = role granted globally (e.g. super_admin). Non-null = role granted
    // only within a specific workspace; query code must filter by this column
    // when checking workspace-scoped permissions.
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }), // Support for temporary roles
  },
  (self) => [
    // Uniqueness is per (user, role, workspace). Use COALESCE so postgres
    // treats null workspaceId as a real value (global scope) rather than
    // always-distinct — otherwise a user could be granted the same global
    // role twice.
    uniqueIndex('rbac_user_roles_user_role_scope_unique').on(
      self.userId,
      self.roleId,
      sql`COALESCE(${self.workspaceId}, '')`,
    ),
    index('rbac_user_roles_user_id_idx').on(self.userId),
    index('rbac_user_roles_role_id_idx').on(self.roleId),
    index('rbac_user_roles_workspace_id_idx').on(self.workspaceId),
  ],
);

export type NewUserRole = typeof userRoles.$inferInsert;
export type UserRoleItem = typeof userRoles.$inferSelect;
