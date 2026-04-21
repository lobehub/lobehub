import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamps, timestamptz, varchar255 } from './_helpers';
import { agents } from './agent';
import { agentCronJobs } from './agentCronJob';
import { documents } from './file';
import { topics } from './topic';
import { users } from './user';

// ── Tasks ────────────────────────────────────────────────

export const tasks = pgTable(
  'tasks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('tasks'))
      .notNull(),

    // Workspace-level identifier (e.g. 'T-1', 'PROJ-42')
    identifier: text('identifier').notNull(),
    seq: integer('seq').notNull(),
    // Creator (user or agent)
    createdByUserId: text('created_by_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdByAgentId: text('created_by_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),

    // Assignee (user and agent can coexist, both nullable)
    assigneeUserId: text('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
    assigneeAgentId: text('assignee_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),

    // Tree structure (self-referencing, no depth limit)
    parentTaskId: text('parent_task_id'),

    // Task definition
    name: text('name'),
    description: varchar255('description'),
    instruction: text('instruction').notNull(),

    // Lifecycle (same state machine for user and agent)
    // 'backlog' | 'running' | 'paused' | 'completed' | 'failed' | 'canceled'
    status: text('status').notNull().default('backlog'),
    priority: integer('priority').default(0), // 'no' | 'urgent' | 'high' | 'normal' | 'low'
    sortOrder: integer('sort_order').default(0), // manual sort within parent, lower = higher

    // Automation mode (mutually exclusive with each other; null = no automation)
    automationMode: text('automation_mode').$type<'heartbeat' | 'schedule'>(),

    // Heartbeat
    heartbeatInterval: integer('heartbeat_interval'), // seconds, null = no heartbeat configured
    heartbeatTimeout: integer('heartbeat_timeout'), // seconds, null = disabled (default off)
    lastHeartbeatAt: timestamptz('last_heartbeat_at'),

    // Schedule (optional)
    schedulePattern: text('schedule_pattern'),
    scheduleTimezone: text('schedule_timezone').default('UTC'),

    // Topic management
    totalTopics: integer('total_topics').default(0),
    maxTopics: integer('max_topics'), // null = unlimited
    currentTopicId: text('current_topic_id').references(() => topics.id, { onDelete: 'set null' }),

    // Context & config (each task independent, no inheritance from parent)
    context: jsonb('context').default({}),
    config: jsonb('config').default({}), // CheckpointConfig, ReviewConfig, etc.
    error: text('error'),

    // Timestamps
    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),
    ...timestamps,
  },
  (t) => [
    // Self-referential FK (defined here to avoid TS circular inference)
    foreignKey({
      columns: [t.parentTaskId],
      foreignColumns: [t.id],
      name: 'tasks_parent_task_id_tasks_id_fk',
    }).onDelete('set null'),
    uniqueIndex('tasks_identifier_idx').on(t.identifier, t.createdByUserId),
    index('tasks_created_by_user_id_idx').on(t.createdByUserId),
    index('tasks_created_by_agent_id_idx').on(t.createdByAgentId),
    index('tasks_assignee_user_id_idx').on(t.assigneeUserId),
    index('tasks_assignee_agent_id_idx').on(t.assigneeAgentId),
    index('tasks_parent_task_id_idx').on(t.parentTaskId),
    index('tasks_status_idx').on(t.status),
    index('tasks_priority_idx').on(t.priority),
    index('tasks_automation_mode_idx').on(t.automationMode),
    index('tasks_heartbeat_idx').on(t.status, t.lastHeartbeatAt),
  ],
);

// ── Task Dependencies ────────────────────────────────────

export const taskDependencies = pgTable(
  'task_dependencies',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    taskId: text('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    dependsOnId: text('depends_on_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    // 'blocks' | 'relates'
    type: text('type').notNull().default('blocks'),

    // Reserved for conditional dependencies: {"on": "success"} / {"on": "failure"}
    condition: jsonb('condition'),

    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('task_deps_unique_idx').on(t.taskId, t.dependsOnId),
    index('task_deps_task_id_idx').on(t.taskId),
    index('task_deps_depends_on_id_idx').on(t.dependsOnId),
    index('task_deps_user_id_idx').on(t.userId),
  ],
);

export type NewTaskDependency = typeof taskDependencies.$inferInsert;
export type TaskDependencyItem = typeof taskDependencies.$inferSelect;

// ── Task Documents (MVP Workspace) ───────────────────────

export const taskDocuments = pgTable(
  'task_documents',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    taskId: text('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    documentId: text('document_id')
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    // 'agent' | 'user' | 'system'
    pinnedBy: text('pinned_by').notNull().default('agent'),

    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('task_docs_unique_idx').on(t.taskId, t.documentId),
    index('task_docs_task_id_idx').on(t.taskId),
    index('task_docs_document_id_idx').on(t.documentId),
    index('task_docs_user_id_idx').on(t.userId),
  ],
);

export type NewTaskDocument = typeof taskDocuments.$inferInsert;
export type TaskDocumentItem = typeof taskDocuments.$inferSelect;

// ── Task Topics ─────────────────────────────────────────

export const taskTopics = pgTable(
  'task_topics',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    taskId: text('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    seq: integer('seq').notNull(), // topic sequence within task (1, 2, 3...)
    operationId: text('operation_id'), // agent execution operation ID
    // 'running' | 'completed' | 'failed' | 'timeout' | 'canceled'
    status: text('status').notNull().default('running'),

    // Handoff (populated after topic completes via LLM summarization)
    // { title, summary, keyFindings: string[], nextAction }
    handoff: jsonb('handoff'),

    // Review results (populated after topic completes + review runs)
    reviewPassed: integer('review_passed'), // 1 = passed, 0 = failed, null = not reviewed
    reviewScore: integer('review_score'), // overall score 0-100
    reviewScores: jsonb('review_scores'), // [{rubricId, score, passed, reason}]
    reviewIteration: integer('review_iteration'), // which iteration (1, 2, 3...)
    reviewedAt: timestamptz('reviewed_at'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('task_topics_unique_idx').on(t.taskId, t.topicId),
    index('task_topics_task_id_idx').on(t.taskId),
    index('task_topics_topic_id_idx').on(t.topicId),
    index('task_topics_user_id_idx').on(t.userId),
    index('task_topics_status_idx').on(t.taskId, t.status),
  ],
);

export type NewTaskTopic = typeof taskTopics.$inferInsert;
export type TaskTopicItem = typeof taskTopics.$inferSelect;

// ── Briefs ─────────────────────────────────────────────

export const briefs = pgTable(
  'briefs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('briefs'))
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    // Source (polymorphic, fill as needed)
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    cronJobId: text('cron_job_id').references(() => agentCronJobs.id, { onDelete: 'cascade' }),
    topicId: text('topic_id'),
    agentId: text('agent_id'),

    // Content
    type: text('type').notNull(), // 'decision' | 'result' | 'insight' | 'error'
    priority: text('priority').default('info'), // 'urgent' | 'normal' | 'info'
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    artifacts: jsonb('artifacts'), // document ids
    actions: jsonb('actions'), // BriefAction[]

    // Resolution
    resolvedAction: text('resolved_action'),
    resolvedComment: text('resolved_comment'),
    readAt: timestamptz('read_at'),
    resolvedAt: timestamptz('resolved_at'),

    createdAt: createdAt(),
  },
  (t) => [
    index('briefs_user_id_idx').on(t.userId),
    index('briefs_task_id_idx').on(t.taskId),
    index('briefs_cron_job_id_idx').on(t.cronJobId),
    index('briefs_agent_id_idx').on(t.agentId),
    index('briefs_type_idx').on(t.type),
    index('briefs_priority_idx').on(t.priority),
    index('briefs_unresolved_idx').on(t.userId, t.resolvedAt),
  ],
);

export type NewBrief = typeof briefs.$inferInsert;
export type BriefItem = typeof briefs.$inferSelect;

// ── Task Comments ───────────────────────────────────────

export const taskComments = pgTable(
  'task_comments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('taskComments'))
      .notNull(),
    taskId: text('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    // Author (user or agent, both nullable)
    authorUserId: text('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    authorAgentId: text('author_agent_id').references(() => agents.id, { onDelete: 'set null' }),

    // Content
    content: text('content').notNull(),
    editorData: jsonb('editor_data'),

    // Optional references
    briefId: text('brief_id').references(() => briefs.id, { onDelete: 'set null' }),
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),

    ...timestamps,
  },
  (t) => [
    index('task_comments_task_id_idx').on(t.taskId),
    index('task_comments_user_id_idx').on(t.userId),
    index('task_comments_author_user_id_idx').on(t.authorUserId),
    index('task_comments_agent_id_idx').on(t.authorAgentId),
    index('task_comments_brief_id_idx').on(t.briefId),
    index('task_comments_topic_id_idx').on(t.topicId),
  ],
);

export type NewTaskComment = typeof taskComments.$inferInsert;
export type TaskCommentItem = typeof taskComments.$inferSelect;
