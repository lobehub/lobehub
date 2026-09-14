import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';
import { documents } from './file';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Durable targeted-rewrite lifecycle. Keep this as text (rather than a
 * PostgreSQL enum) so a rolling deployment can add a state without an enum
 * rewrite; the check constraint still rejects unknown values at the DB edge.
 */
export const DOCUMENT_REWRITE_REQUEST_STATUSES = [
  'queued',
  'connecting',
  'syncing',
  'thinking',
  'writing',
  'awaiting_review',
  'applied',
  'rejected',
  'cancel_requested',
  'canceled',
  'canceled_after_write',
  'retry_wait',
  'stale',
  'failed',
] as const;

export type DocumentRewriteRequestStatus = (typeof DOCUMENT_REWRITE_REQUEST_STATUSES)[number];

export type DocumentRewriteTargetKind = 'node' | 'text-range';

/** Public rewrite progress stages. Raw model reasoning is never a stage. */
export const DOCUMENT_REWRITE_PROGRESS_STAGES = [
  'analyzing_context',
  'reading_structure',
  'reading_block',
  'reading_search',
  'generating_replacement',
  'applying',
  'syncing',
] as const;

export type DocumentRewriteProgressStage = (typeof DOCUMENT_REWRITE_PROGRESS_STAGES)[number];

export const DOCUMENT_REWRITE_PROGRESS_TOOLS = [
  'read_document_structure',
  'read_document_block',
  'read_document_range',
  'search_document_text',
] as const;

/** Keep progress useful for the UI without turning it into a transcript. */
export const DOCUMENT_REWRITE_PROGRESS_MAX_EVENTS = 32;
export const DOCUMENT_REWRITE_PROGRESS_DETAIL_MAX_LENGTH = 160;
export const DOCUMENT_REWRITE_PROGRESS_SUMMARY_MAX_LENGTH = 512;
export const DOCUMENT_REWRITE_PROGRESS_TOOL_MAX_LENGTH = 64;

export interface DocumentRewriteProgressEvent {
  at: string;
  detail?: string;
  stage: DocumentRewriteProgressStage;
  summary?: string;
  tool?: string;
}

export interface DocumentRewriteProgress {
  currentStage: DocumentRewriteProgressStage;
  events: DocumentRewriteProgressEvent[];
  summary?: string;
  updatedAt: string;
}

/** Wire-compatible selection anchor from the editor SDD. */
export interface DocumentRewriteSelection {
  adapterId?: string;
  anchorPos?: Record<string, unknown>;
  /** Hash of the durable text projection produced by the applied rewrite. */
  appliedTextHash?: string;
  baseStateVector?: string;
  capturedAt?: string;
  endNodeId?: string;
  endOffset?: number;
  focusPos?: Record<string, unknown>;
  kind: 'relative' | 'block';
  quotedText: string;
  quotedTextHash: string;
  roomId?: string;
  /** Source/content proof captured by the adapter for node targets. */
  sourceHash?: string;
  startNodeId?: string;
  startOffset?: number;
  /** Text range (default) or an adapter-owned atomic node target. */
  targetKind?: DocumentRewriteTargetKind;
  /** Durable logical node id for an adapter-owned target. */
  targetNodeId?: string;
  /**
   * Optional complete block projection for a multi-block relative range. It
   * is captured by the browser and revalidated by the server; the endpoints
   * are only a fallback for legacy callers that cannot provide the full list.
   */
  targetNodeIds?: string[];
}

/**
 * One durable request per user action. The document remains the source of
 * truth for ACL/visibility; this row stores only the request and worker lease
 * state, never a room ticket or provider secret.
 */
export const documentRewriteRequests = pgTable(
  'document_rewrite_requests',
  {
    id: varchar('id', { length: 255 })
      .$defaultFn(() => idGenerator('documentRewriteRequests', 18))
      .primaryKey()
      .notNull(),

    documentId: varchar('document_id', { length: 255 })
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    /** Server-issued conversation identity shared by all rewrite turns. */
    sessionId: varchar('session_id', { length: 255 }).notNull(),
    /** Previous durable request in this rewrite conversation, if any. */
    parentRequestId: varchar('parent_request_id', { length: 255 }),
    /** Monotonic turn number within session; the first request is 1. */
    turnIndex: integer('turn_index').default(1).notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    requestedByUserId: text('requested_by_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** Agent identity is retained as an audit value even if its row is removed. */
    agentId: text('agent_id').notNull(),
    operationId: text('operation_id'),
    topicId: text('topic_id'),
    toolCallId: text('tool_call_id'),

    instruction: text('instruction').notNull(),
    selection: jsonb('selection').$type<DocumentRewriteSelection>().notNull(),
    /** Denormalized quote allows the DB length check and cheap status payloads. */
    quotedText: text('quoted_text').default('').notNull(),
    /**
     * Canonical target projection retained for idempotency/audit compatibility.
     * Exact overlap is checked from the selection range while holding the
     * document row lock; this key is intentionally not a unique reservation.
     */
    targetKey: varchar('target_key', { length: 767 }),
    /** Durable block IDs used for conservative overlap checks before claiming. */
    targetNodeIds: text('target_node_ids').array().default([]).notNull(),

    status: text('status', { enum: DOCUMENT_REWRITE_REQUEST_STATUSES }).default('queued').notNull(),
    attempt: integer('attempt').default(1).notNull(),
    version: integer('version').default(1).notNull(),

    generationId: text('generation_id'),
    model: text('model'),
    provider: text('provider'),
    /** User-selected model snapshot; never cleared by an automatic retry. */
    requestedModel: text('requested_model'),
    /** User-selected provider snapshot; never cleared by an automatic retry. */
    requestedProvider: text('requested_provider'),
    lastCommandId: text('last_command_id'),
    /** Exact replacement committed by a direct rewrite, used for continuation proof/context. */
    outputText: text('output_text'),
    /** Bounded public stages only; raw model reasoning is never persisted. */
    progress: jsonb('progress').$type<DocumentRewriteProgress | null>(),

    errorCode: varchar('error_code', { length: 128 }),
    errorMessage: text('error_message'),
    cancelRequestedAt: timestamptz('cancel_requested_at'),
    expiresAt: timestamptz('expires_at'),
    nextAttemptAt: timestamptz('next_attempt_at'),
    terminalAt: timestamptz('terminal_at'),

    /** Worker lease. A claim is valid only while the owner and lease match. */
    claimOwner: varchar('claim_owner', { length: 255 }),
    claimedAt: timestamptz('claimed_at'),
    leaseExpiresAt: timestamptz('lease_expires_at'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('document_rewrite_requests_document_status_idx').on(table.documentId, table.status),
    index('document_rewrite_requests_status_next_attempt_idx').on(
      table.status,
      table.nextAttemptAt,
      table.createdAt,
    ),
    index('document_rewrite_requests_agent_status_idx').on(table.agentId, table.status),
    index('document_rewrite_requests_claim_lease_idx').on(table.claimOwner, table.leaseExpiresAt),
    index('document_rewrite_requests_user_created_at_idx').on(
      table.requestedByUserId,
      table.createdAt,
    ),
    index('document_rewrite_requests_document_session_turn_idx').on(
      table.documentId,
      table.sessionId,
      table.turnIndex,
    ),
    index('document_rewrite_requests_parent_idx').on(table.parentRequestId),
    index('document_rewrite_requests_target_node_ids_gin_idx').using('gin', table.targetNodeIds),
    check(
      'document_rewrite_requests_status_check',
      sql`${table.status} IN ('queued', 'connecting', 'syncing', 'thinking', 'writing', 'awaiting_review', 'applied', 'rejected', 'cancel_requested', 'canceled', 'canceled_after_write', 'retry_wait', 'stale', 'failed')`,
    ),
    check(
      'document_rewrite_requests_instruction_length_check',
      sql`char_length(${table.instruction}) <= 32768`,
    ),
    check(
      'document_rewrite_requests_quoted_text_length_check',
      sql`char_length(${table.quotedText}) <= 32768`,
    ),
    check(
      'document_rewrite_requests_output_text_length_check',
      sql`${table.outputText} IS NULL OR char_length(${table.outputText}) <= 32768`,
    ),
    check(
      'document_rewrite_requests_error_message_length_check',
      sql`${table.errorMessage} IS NULL OR char_length(${table.errorMessage}) <= 16384`,
    ),
    check(
      'document_rewrite_requests_progress_size_check',
      sql`${table.progress} IS NULL OR pg_column_size(${table.progress}) <= 32768`,
    ),
    check('document_rewrite_requests_attempt_positive', sql`${table.attempt} > 0`),
    check('document_rewrite_requests_turn_index_positive', sql`${table.turnIndex} > 0`),
    check('document_rewrite_requests_version_positive', sql`${table.version} > 0`),
  ],
);

export type NewDocumentRewriteRequest = typeof documentRewriteRequests.$inferInsert;
export type DocumentRewriteRequestItem = typeof documentRewriteRequests.$inferSelect;
