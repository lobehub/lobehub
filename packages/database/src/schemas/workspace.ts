import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { createNanoId } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';
import { users } from './user';

export const workspaces = pgTable(
  'workspaces',
  {
    id: text('id')
      .$defaultFn(() => createNanoId(16)())
      .notNull()
      .primaryKey(),
    slug: varchar('slug', { length: 100 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: varchar('description', { length: 1000 }),
    avatar: text('avatar'),
    // The user whose payment method backs the workspace's subscription. A
    // workspace can have multiple `role='owner'` members; only this one is the
    // Stripe-bound owner. Transferring the Stripe binding goes through
    // `WorkspaceModel.transferPrimaryOwnership`.
    primaryOwnerId: text('primary_owner_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    settings: jsonb('settings').default({}),
    // Freeze state, mirrors the `users.banned` / `banReason` / `banExpires`
    // trio. Driven by cloud risk control (abnormal spend) and admin tooling;
    // OSS column with no desktop/open-source behavior attached.
    frozen: boolean('frozen').default(false),
    frozenReason: text('frozen_reason'),
    frozenAt: timestamptz('frozen_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('workspaces_slug_idx').on(t.slug),
    index('workspaces_primary_owner_id_idx').on(t.primaryOwnerId),
  ],
);

export type WorkspaceItem = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').notNull().default('member'),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
    updatedAt: updatedAt(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    // Composite PK guarantees one row per (workspace, user). Without it the
    // `addMember` ON CONFLICT DO NOTHING falls back to a no-op append and a
    // user can be inserted into the same workspace multiple times.
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('workspace_members_user_id_idx').on(t.userId),
  ],
);

export type WorkspaceMemberItem = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;

export const workspaceInvitations = pgTable(
  'workspace_invitations',
  {
    id: text('id')
      .$defaultFn(() => createNanoId(16)())
      .notNull()
      .primaryKey(),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    inviterId: text('inviter_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    email: text('email'),
    role: text('role').notNull().default('member'),
    token: text('token').unique().notNull(),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('workspace_invitations_workspace_id_idx').on(t.workspaceId),
    index('workspace_invitations_email_idx').on(t.email),
    index('workspace_invitations_token_idx').on(t.token),
  ],
);

export type WorkspaceInvitationItem = typeof workspaceInvitations.$inferSelect;
export type NewWorkspaceInvitation = typeof workspaceInvitations.$inferInsert;

export const workspaceAuditLogs = pgTable(
  'workspace_audit_logs',
  {
    id: text('id')
      .$defaultFn(() => createNanoId(16)())
      .notNull()
      .primaryKey(),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    metadata: jsonb('metadata').default({}),
    ipAddress: text('ip_address'),
    createdAt: createdAt(),
  },
  (t) => [
    index('workspace_audit_logs_workspace_id_idx').on(t.workspaceId),
    index('workspace_audit_logs_action_idx').on(t.action),
    index('workspace_audit_logs_created_at_idx').on(t.createdAt),
  ],
);

export type WorkspaceAuditLogItem = typeof workspaceAuditLogs.$inferSelect;
export type NewWorkspaceAuditLog = typeof workspaceAuditLogs.$inferInsert;
