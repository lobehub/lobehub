import type {
  HeterogeneousAgentInterventionKind,
  HeterogeneousAgentInterventionProvider,
  HeterogeneousAgentInterventionResolutionPayload,
  HeterogeneousAgentInterventionReviewContext,
  HeterogeneousAgentInterventionSanitizedRequest,
  HeterogeneousAgentInterventionStatus,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from './_helpers';
import { agentOperations } from './agentOperations';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Durable heterogeneous-agent intervention state.
 *
 * Unlike the general AgentRuntime approval metadata, this is one row per
 * `(operationId, toolCallId)`: one CLI operation can block on multiple
 * callbacks over its lifetime, and every callback needs its own deadline,
 * first-winner claim, producer acknowledgement, and audit state.
 */
export const heterogeneousAgentInterventions = pgTable(
  'heterogeneous_agent_interventions',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    operationId: text('operation_id')
      .references(() => agentOperations.id, { onDelete: 'cascade' })
      .notNull(),
    toolCallId: text('tool_call_id').notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade',
    }),

    provider: text('provider').$type<HeterogeneousAgentInterventionProvider>().notNull(),
    interactionKind: text('interaction_kind').$type<HeterogeneousAgentInterventionKind>().notNull(),

    /**
     * SHA-256 hex digest of the 32-byte base64url locator carried by the Review
     * URL. The raw token is never persisted or logged; every lookup hashes the
     * presented token before reaching this owner-scoped model.
     */
    reviewTokenHash: text('review_token_hash').notNull(),

    reviewContext: jsonb('review_context')
      .$type<HeterogeneousAgentInterventionReviewContext>()
      .notNull(),
    sanitizedRequest: jsonb('sanitized_request')
      .$type<HeterogeneousAgentInterventionSanitizedRequest>()
      .notNull(),

    deadline: timestamptz('deadline').notNull(),
    status: text('status')
      .$type<HeterogeneousAgentInterventionStatus>()
      .default('pending')
      .notNull(),

    /** Client UUID that won `pending -> resolving`; retained for idempotent retries. */
    resolutionRequestId: uuid('resolution_request_id'),
    resolutionPayload:
      jsonb('resolution_payload').$type<HeterogeneousAgentInterventionResolutionPayload>(),
    resolutionActorId: text('resolution_actor_id'),
    resolvingAt: timestamptz('resolving_at'),
    resolvedAt: timestamptz('resolved_at'),

    /** Set only after the blocked CLI callback confirms it consumed the response. */
    producerAckAt: timestamptz('producer_ack_at'),

    /** Incremented by every state transition for observability and stale-write detection. */
    version: integer('version').default(1).notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('heterogeneous_agent_interventions_operation_tool_call_unique').on(
      table.operationId,
      table.toolCallId,
    ),
    uniqueIndex('heterogeneous_agent_interventions_review_token_hash_unique').on(
      table.reviewTokenHash,
    ),
    uniqueIndex('heterogeneous_agent_interventions_resolution_request_unique')
      .on(table.resolutionRequestId)
      .where(sql`${table.resolutionRequestId} IS NOT NULL`),
    index('heterogeneous_agent_interventions_owner_status_deadline_idx').on(
      table.userId,
      table.workspaceId,
      table.status,
      table.deadline,
    ),
    index('heterogeneous_agent_interventions_status_deadline_idx').on(table.status, table.deadline),
    check(
      'heterogeneous_agent_interventions_review_token_hash_check',
      sql`${table.reviewTokenHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check('heterogeneous_agent_interventions_version_check', sql`${table.version} > 0`),
    check(
      'heterogeneous_agent_interventions_resolution_bundle_check',
      sql`
        (
          ${table.resolutionRequestId} IS NULL
          AND ${table.resolutionPayload} IS NULL
          AND ${table.resolutionActorId} IS NULL
          AND ${table.resolvingAt} IS NULL
        )
        OR (
          ${table.resolutionRequestId} IS NOT NULL
          AND ${table.resolutionPayload} IS NOT NULL
          AND ${table.resolutionActorId} IS NOT NULL
          AND ${table.resolvingAt} IS NOT NULL
        )
      `,
    ),
    check(
      'heterogeneous_agent_interventions_producer_ack_check',
      sql`${table.producerAckAt} IS NULL OR ${table.resolvedAt} IS NOT NULL`,
    ),
  ],
);

export type NewHeterogeneousAgentIntervention = typeof heterogeneousAgentInterventions.$inferInsert;
export type HeterogeneousAgentInterventionItem =
  typeof heterogeneousAgentInterventions.$inferSelect;
