import type { VerifyCheckItem } from '@lobechat/types';
import { boolean, index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { amountNumeric, timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { chatGroups } from './chatGroup';
import { tasks } from './task';
import { threads, topics } from './topic';
import { workspaces } from './workspace';

const operationStatuses = [
  'idle',
  'running',
  'waiting_for_human',
  'waiting_for_async_tool',
  'done',
  'error',
  'interrupted',
] as const;

const completionReasons = [
  'done',
  'error',
  'interrupted',
  'max_steps',
  'cost_limit',
  'waiting_for_human',
  'waiting_for_async_tool',
] as const;

/**
 * Denormalized rollup of the operation's verify (delivery checker) state.
 * Lets the operation list page render badges / filter without joining the
 * verify_* tables. It is a rollup of plan.status + result aggregation and MUST
 * be updated through the service layer (on plan confirm / each result / repair)
 * to avoid drift.
 */
const verifyStatuses = [
  'unverified',
  'planned',
  'verifying',
  'passed',
  'failed',
  'repairing',
  'delivered',
] as const;

export interface AgentOperationInterruption {
  canResume: boolean;
  interruptedAt: string;
  reason: string;
}

export interface AgentOperationError {
  [key: string]: unknown;
  message?: string;
  stack?: string;
  type?: string;
}

export interface AgentOperationAppContext {
  defaultTaskAssigneeAgentId?: string;
  documentId?: string | null;
  groupId?: string | null;
  scope?: string | null;
  sessionId?: string;
  sourceMessageId?: string;
}

export const agentOperations = pgTable(
  'agent_operations',
  {
    // ---- Identity (operationId is supplied by the agent runtime) ----
    id: text('id').primaryKey().notNull(),

    /**
     * Preserved across user deletion — operations are valuable historical/audit data,
     * so this column is intentionally not a foreign key.
     */
    userId: text('user_id').notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    threadId: text('thread_id').references(() => threads.id, { onDelete: 'set null' }),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    chatGroupId: text('chat_group_id').references(() => chatGroups.id, { onDelete: 'set null' }),

    /** Self-reference for sub-agent operations spawned via callAgent. */
    parentOperationId: text('parent_operation_id'),

    // ---- Lifecycle ----
    status: text('status', { enum: operationStatuses }).notNull(),
    completionReason: text('completion_reason', { enum: completionReasons }),

    // ---- Verify (delivery checker) ----
    /** Denormalized rollup of the verify pipeline state. */
    verifyStatus: text('verify_status', { enum: verifyStatuses }),
    /**
     * Immutable check-plan snapshot for this run (1:1, instantiated from rubrics /
     * agent-generated, frozen on confirm). verify_check_results relate to its items
     * via check_item_id. auto-repair spawns a NEW operation, so this stays 1:1.
     */
    verifyPlan: jsonb('verify_plan').$type<VerifyCheckItem[]>(),
    /** When the user confirmed (froze) the plan. */
    verifyPlanConfirmedAt: timestamptz('verify_plan_confirmed_at'),

    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),

    // ---- Execution summary ----
    stepCount: integer('step_count'),
    maxSteps: integer('max_steps'),
    forceFinish: boolean('force_finish'),
    interruption: jsonb('interruption').$type<AgentOperationInterruption>(),
    error: jsonb('error').$type<AgentOperationError>(),

    // ---- Cost & token aggregates (denormalized for analytics) ----
    // Kept nullable: NULL means "not measured yet" so orphaned/in-flight rows
    // don't pollute SUM/AVG aggregates as if they were $0 / 0-token operations.
    totalCost: amountNumeric('total_cost'),
    currency: text('currency').default('USD').notNull(),

    totalInputTokens: integer('total_input_tokens'),
    totalOutputTokens: integer('total_output_tokens'),
    totalTokens: integer('total_tokens'),

    llmCalls: integer('llm_calls'),
    toolCalls: integer('tool_calls'),
    humanInterventions: integer('human_interventions'),

    processingTimeMs: integer('processing_time_ms'),
    humanWaitingTimeMs: integer('human_waiting_time_ms'),

    /** Full Cost.byModel / byTool breakdown for slice-and-dice queries. */
    cost: jsonb('cost').$type<Record<string, unknown>>(),
    /** Full Usage breakdown (per-tool calls, errors, time). */
    usage: jsonb('usage').$type<Record<string, unknown>>(),
    costLimit: jsonb('cost_limit').$type<Record<string, unknown>>(),

    // ---- Runtime config snapshot ----
    model: text('model'),
    provider: text('provider'),
    modelRuntimeConfig: jsonb('model_runtime_config'),
    /** What initiated this operation (chat / signal / cron / bot / eval ...). */
    trigger: text('trigger'),

    /**
     * Extra appContext fields not extracted as columns
     * (sessionId, documentId, groupId, scope, sourceMessageId, ...).
     */
    appContext: jsonb('app_context').$type<AgentOperationAppContext>(),

    // ---- Trace storage ----
    /** S3 object key for the full ExecutionSnapshot JSON. */
    traceS3Key: text('trace_s3_key'),

    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

    ...timestamps,
  },
  (t) => [
    index('agent_operations_user_id_idx').on(t.userId),
    index('agent_operations_workspace_id_idx').on(t.workspaceId),
    index('agent_operations_agent_id_idx').on(t.agentId),
    index('agent_operations_topic_id_idx').on(t.topicId),
    index('agent_operations_thread_id_idx').on(t.threadId),
    index('agent_operations_task_id_idx').on(t.taskId),
    index('agent_operations_chat_group_id_idx').on(t.chatGroupId),
    index('agent_operations_parent_operation_id_idx').on(t.parentOperationId),
    index('agent_operations_status_idx').on(t.status),
    index('agent_operations_user_id_created_at_idx').on(t.userId, t.createdAt),
    index('agent_operations_metadata_idx').using('gin', t.metadata),
  ],
);

export type NewAgentOperation = typeof agentOperations.$inferInsert;
export type AgentOperationItem = typeof agentOperations.$inferSelect;
