/* eslint-disable sort-keys-fix/sort-keys-fix  */
import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

import { createNanoId } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { users } from './user';

// Roles table
export const roles = pgTable('rbac_roles', {
  id: text('id')
    .$defaultFn(() => createNanoId(16)())
    .notNull()
    .primaryKey(),

  name: text('name').notNull().unique(), // Role name, e.g.: admin, user, guest
  displayName: text('display_name').notNull(), // Display name
  description: text('description'), // Role description
  isSystem: boolean('is_system').default(false).notNull(), // Whether it's a system role
  isActive: boolean('is_active').default(true).notNull(), // Whether it's active
  metadata: jsonb('metadata').default({}), // Role metadata

  ...timestamps,
});

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

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }), // Support for temporary roles
  },
  (self) => [
    primaryKey({ columns: [self.userId, self.roleId] }),
    index('rbac_user_roles_user_id_idx').on(self.userId),
    index('rbac_user_roles_role_id_idx').on(self.roleId),
  ],
);

export type NewUserRole = typeof userRoles.$inferInsert;
export type UserRoleItem = typeof userRoles.$inferSelect;
