import type {
  AgentInterventionAllowedAction,
  AgentInterventionApprovalMode,
  AgentInterventionArgumentEffectStatus,
  AgentInterventionCustomExecutionResult,
  AgentInterventionCustomExecutionState,
  AgentInterventionExpectedRequestRevisionHashes,
  AgentInterventionExpectedVersions,
  AgentInterventionKind,
  AgentInterventionRememberEffectStatus,
  AgentInterventionResolutionAction,
  AgentInterventionResolutionScope,
  AgentInterventionResolutionStatus,
  AgentInterventionReviewContext,
  AgentInterventionRisk,
  AgentInterventionSanitizedRequest,
  AgentInterventionSource,
  AgentInterventionStatus,
  AgentInterventionSurface,
  AgentInterventionSystemActionEligibility,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from './_helpers';
import { agentOperations } from './agentOperations';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Private resolution/outbox records. Unlike `agent_interventions`, this table
 * may retain user-edited arguments so a claimed decision can be delivered
 * reliably after the app disconnects. It is never a notification payload.
 */
export const agentInterventionResolutions = pgTable(
  'agent_intervention_resolutions',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    resolutionRequestId: uuid('resolution_request_id').notNull(),

    operationId: text('operation_id')
      .references(() => agentOperations.id, { onDelete: 'cascade' })
      .notNull(),
    batchId: text('batch_id').notNull(),
    source: text('source').$type<AgentInterventionSource>().notNull(),

    /** Owner of the durable operation, distinct from the resolving actor. */
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade',
    }),
    /** Explicitly supplied by the ACL-gated service; never inferred from owner. */
    actorId: text('actor_id').notNull(),

    scope: text('scope').$type<AgentInterventionResolutionScope>().notNull(),
    selectedInterventionIds: jsonb('selected_intervention_ids').$type<string[]>().notNull(),
    expectedVersions: jsonb('expected_versions')
      .$type<AgentInterventionExpectedVersions>()
      .notNull(),
    expectedRequestRevisionHashes: jsonb('expected_request_revision_hashes')
      .$type<AgentInterventionExpectedRequestRevisionHashes>()
      .notNull(),
    expectedItemCount: integer('expected_item_count').notNull(),
    action: jsonb('action').$type<AgentInterventionResolutionAction>().notNull(),

    /** Private SHA-256 identity of the custom execution input. */
    customExecutionInputHash: varchar('custom_execution_input_hash', { length: 64 }),
    /** Independent from the resolution delivery/outbox lifecycle above. */
    customExecutionState:
      text('custom_execution_state').$type<AgentInterventionCustomExecutionState>(),
    /** Monotonic lease attempt, starting at zero while pending. */
    customExecutionAttempt: integer('custom_execution_attempt'),
    /** Opaque fencing token retained after completion for idempotent replay. */
    customExecutionLeaseToken: uuid('custom_execution_lease_token'),
    customExecutionLeaseExpiresAt: timestamptz('custom_execution_lease_expires_at'),
    /** Private executor result; never selected into Review or notification DTOs. */
    customExecutionResult:
      jsonb('custom_execution_result').$type<AgentInterventionCustomExecutionResult>(),

    rememberToolKey: text('remember_tool_key'),
    rememberEffectStatus:
      text('remember_effect_status').$type<AgentInterventionRememberEffectStatus>(),
    /** Private compare-and-swap journal for rollback of a user argument edit. */
    originalArguments: text('original_arguments'),
    editedArguments: text('edited_arguments'),
    originalRequestRevisionHash: text('original_request_revision_hash'),
    editedRequestRevisionHash: text('edited_request_revision_hash'),
    argumentEffectStatus:
      text('argument_effect_status').$type<AgentInterventionArgumentEffectStatus>(),

    status: text('status')
      .$type<AgentInterventionResolutionStatus>()
      .default('resolving')
      .notNull(),
    resolvingAt: timestamptz('resolving_at').defaultNow().notNull(),
    publishedAt: timestamptz('published_at'),
    continuationStartedAt: timestamptz('continuation_started_at'),
    producerAckAt: timestamptz('producer_ack_at'),
    terminalAt: timestamptz('terminal_at'),
    rolledBackAt: timestamptz('rolled_back_at'),

    version: integer('version').default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('agent_intervention_resolutions_request_unique').on(table.resolutionRequestId),
    index('agent_intervention_resolutions_owner_batch_idx').on(
      table.userId,
      table.workspaceId,
      table.batchId,
    ),
    index('agent_intervention_resolutions_status_created_idx').on(table.status, table.createdAt),
    check(
      'agent_intervention_resolutions_expected_item_count_check',
      sql`${table.expectedItemCount} > 0`,
    ),
    check(
      'agent_intervention_resolutions_custom_execution_input_hash_check',
      sql`${table.customExecutionInputHash} IS NULL OR ${table.customExecutionInputHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'agent_intervention_resolutions_custom_execution_state_check',
      sql`(
        (${table.customExecutionState} IS NULL
          AND ${table.customExecutionInputHash} IS NULL
          AND ${table.customExecutionAttempt} IS NULL
          AND ${table.customExecutionLeaseToken} IS NULL
          AND ${table.customExecutionLeaseExpiresAt} IS NULL
          AND ${table.customExecutionResult} IS NULL)
        OR
        (${table.customExecutionState} = 'pending'
          AND ${table.customExecutionAttempt} = 0
          AND ${table.customExecutionLeaseToken} IS NULL
          AND ${table.customExecutionLeaseExpiresAt} IS NULL
          AND ${table.customExecutionResult} IS NULL)
        OR
        (${table.customExecutionState} = 'executing'
          AND ${table.customExecutionInputHash} IS NOT NULL
          AND ${table.customExecutionAttempt} > 0
          AND ${table.customExecutionLeaseToken} IS NOT NULL
          AND ${table.customExecutionLeaseExpiresAt} IS NOT NULL
          AND ${table.customExecutionResult} IS NULL)
        OR
        (${table.customExecutionState} = 'completed'
          AND ${table.customExecutionInputHash} IS NOT NULL
          AND ${table.customExecutionAttempt} > 0
          AND ${table.customExecutionLeaseToken} IS NOT NULL
          AND ${table.customExecutionLeaseExpiresAt} IS NOT NULL
          AND ${table.customExecutionResult} IS NOT NULL)
      )`,
    ),
    check(
      'agent_intervention_resolutions_custom_execution_parent_status_check',
      sql`${table.customExecutionState} NOT IN ('executing', 'completed') OR ${table.status} IN ('resolving', 'published', 'acknowledged', 'completed')`,
    ),
    check('agent_intervention_resolutions_version_check', sql`${table.version} > 0`),
  ],
);

/**
 * Notification-safe durable state for every pending intervention item. Raw
 * arguments are absent: authorized Review code loads the authoritative message
 * by `toolMessageId` and checks `requestRevisionHash` before mutation.
 */
export const agentInterventions = pgTable(
  'agent_interventions',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    operationId: text('operation_id')
      .references(() => agentOperations.id, { onDelete: 'cascade' })
      .notNull(),
    toolCallId: text('tool_call_id').notNull(),
    toolMessageId: text('tool_message_id'),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade',
    }),

    source: text('source').$type<AgentInterventionSource>().notNull(),
    provider: text('provider'),
    interactionKind: text('interaction_kind').$type<AgentInterventionKind>().notNull(),
    surface: text('surface').$type<AgentInterventionSurface>().notNull(),
    systemActionEligibility: text('system_action_eligibility')
      .$type<AgentInterventionSystemActionEligibility>()
      .notNull(),
    approvalMode: text('approval_mode').$type<AgentInterventionApprovalMode>(),

    /** Stable grouping for exactly one paused step and its complete item set. */
    batchId: text('batch_id').notNull(),
    /** Opaque shared key used to correlate one Live Activity per batch. */
    activityKey: text('activity_key').notNull(),
    stepIndex: integer('step_index').notNull(),
    itemIndex: integer('item_index').notNull(),
    itemCount: integer('item_count').notNull(),
    sealed: boolean('sealed').default(false).notNull(),

    canonicalToolKey: text('canonical_tool_key'),
    requestRevisionHash: text('request_revision_hash').notNull(),
    allowedActions: jsonb('allowed_actions').$type<AgentInterventionAllowedAction[]>().notNull(),
    risk: jsonb('risk').$type<AgentInterventionRisk>(),

    /** SHA-256 hex digest of the raw locator; raw Review tokens are never stored. */
    reviewTokenHash: text('review_token_hash').notNull(),
    reviewContext: jsonb('review_context').$type<AgentInterventionReviewContext>().notNull(),
    sanitizedRequest: jsonb('sanitized_request')
      .$type<AgentInterventionSanitizedRequest>()
      .notNull(),

    deadline: timestamptz('deadline').notNull(),
    status: text('status').$type<AgentInterventionStatus>().default('pending').notNull(),
    resolutionId: uuid('resolution_id').references(() => agentInterventionResolutions.id, {
      onDelete: 'set null',
    }),
    resolvingAt: timestamptz('resolving_at'),
    publishedAt: timestamptz('published_at'),
    resolvedAt: timestamptz('resolved_at'),
    producerAckAt: timestamptz('producer_ack_at'),

    /** Incremented by every state transition for stale-snapshot detection. */
    version: integer('version').default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('agent_interventions_operation_tool_call_unique').on(
      table.operationId,
      table.toolCallId,
    ),
    uniqueIndex('agent_interventions_review_token_hash_unique').on(table.reviewTokenHash),
    uniqueIndex('agent_interventions_operation_batch_item_unique').on(
      table.operationId,
      table.batchId,
      table.itemIndex,
    ),
    uniqueIndex('agent_interventions_owner_activity_item_unique').on(
      table.userId,
      table.activityKey,
      table.itemIndex,
    ),
    index('agent_interventions_owner_status_deadline_idx').on(
      table.userId,
      table.workspaceId,
      table.status,
      table.deadline,
    ),
    index('agent_interventions_owner_batch_idx').on(
      table.userId,
      table.workspaceId,
      table.batchId,
      table.itemIndex,
    ),
    index('agent_interventions_activity_key_idx').on(table.userId, table.activityKey),
    index('agent_interventions_status_deadline_idx').on(table.status, table.deadline),
    check(
      'agent_interventions_review_token_hash_check',
      sql`${table.reviewTokenHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'agent_interventions_request_revision_hash_check',
      sql`${table.requestRevisionHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check('agent_interventions_step_index_check', sql`${table.stepIndex} >= 0`),
    check(
      'agent_interventions_item_bounds_check',
      sql`${table.itemCount} > 0 AND ${table.itemIndex} >= 0 AND ${table.itemIndex} < ${table.itemCount}`,
    ),
    check('agent_interventions_version_check', sql`${table.version} > 0`),
  ],
);

export type NewAgentInterventionResolution = typeof agentInterventionResolutions.$inferInsert;
export type AgentInterventionResolutionItem = typeof agentInterventionResolutions.$inferSelect;
export type NewAgentIntervention = typeof agentInterventions.$inferInsert;
export type AgentInterventionItem = typeof agentInterventions.$inferSelect;
