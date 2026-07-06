import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorId: uuid('actor_id').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id'),
  subjectUserId: uuid('subject_user_id'),
  workspaceId: uuid('workspace_id'),
  details: jsonb('details'),
  createdAt: timestamp('created_at').defaultNow(),
});
