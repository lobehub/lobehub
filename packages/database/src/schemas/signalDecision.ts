import type {
  SignalDecisionLabel,
  SignalDecisionLabelMetadata,
  SignalDecisionMetadata,
  SignalDecisionOutcome,
  SignalDecisionVerdict,
} from '@lobechat/types';
import { index, jsonb, pgTable, real, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { createdAt } from './_helpers';
import { agents } from './agent';
import { signals } from './signal';
import { topics } from './topic';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Signal decisions: what a pipeline decided to do with one signal, and why.
 *
 * One row per `(signal, agent, pipeline_version)` — recording the same decision twice is
 * idempotent, while a new pipeline version judging the same signal adds its own row so the two can
 * be compared. `verdicts` keeps every policy's opinion, shadow ones included, so a policy that
 * only observes can be measured against the outcome that actually happened.
 *
 * A classifier's own LLM call is not copied here: it is written to `llm_generation_tracing` and
 * `llm_tracing_ids` points at it.
 *
 * A signal with a decision is exempt from the `signals` retention sweep.
 */
export const signalDecisions = pgTable(
  'signal_decisions',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    signalId: uuid('signal_id')
      .references(() => signals.id, { onDelete: 'cascade' })
      .notNull(),
    /**
     * Kept when the agent is deleted: the decision is a record of what the pipeline did.
     *
     * Nullable only for that case, so the unique index below does not constrain rows without an
     * agent — and must not: making NULLs collide (`NULLS NOT DISTINCT`, or a partial index on
     * `agent_id IS NULL`) would make deleting a second agent that decided the same signal fail on
     * the `SET NULL` update. `SignalDecisionModel.record` requires an agent instead.
     */
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** The channel the signal arrived on; same value as `signals.scope_key`. */
    scopeKey: text('scope_key').notNull(),
    /** Which revision of the pipeline decided, e.g. `bot-wake@1`. */
    pipelineVersion: text('pipeline_version').notNull(),

    outcome: text('outcome').$type<SignalDecisionOutcome>().notNull(),
    /** Machine-readable reason for the outcome, e.g. `explicit-mention`. */
    finalReason: text('final_reason'),
    /** The route or tag the signal was sent to, e.g. `mention`, `dm`, `keyword`. */
    toTag: text('to_tag'),

    verdicts: jsonb('verdicts').$type<SignalDecisionVerdict[]>().notNull().default([]),
    /** `llm_generation_tracing.id`s of the classifier calls behind this decision. */
    llmTracingIds: jsonb('llm_tracing_ids').$type<string[]>().notNull().default([]),

    /** The run the decision started, when it woke one. */
    operationId: text('operation_id'),
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),

    /** The context the decision was made in (state snapshot, config revision); never message content. */
    metadata: jsonb('metadata').$type<SignalDecisionMetadata>().notNull().default({}),

    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('signal_decisions_signal_agent_pipeline_unique').on(
      t.signalId,
      t.agentId,
      t.pipelineVersion,
    ),
    index('signal_decisions_signal_id_idx').on(t.signalId),
    index('signal_decisions_user_scope_created_at_idx').on(t.userId, t.scopeKey, t.createdAt),
    index('signal_decisions_agent_created_at_idx').on(t.agentId, t.createdAt),
  ],
);

/**
 * Judgements attached to a decision after the fact — a user's thumbs, a heuristic, a judge model.
 *
 * Append-only: a changed mind is a new row, and the latest row per `(decision_id, source)` is the
 * current opinion. Nothing here is ever updated, so the history of how a decision was judged stays
 * intact for evaluating the pipeline.
 */
export const signalDecisionLabels = pgTable(
  'signal_decision_labels',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    decisionId: uuid('decision_id')
      .references(() => signalDecisions.id, { onDelete: 'cascade' })
      .notNull(),

    /** Who produced the label: `user`, `heuristic`, `llm_judge`, … */
    source: text('source').notNull(),
    label: text('label').$type<SignalDecisionLabel>().notNull(),
    /** 0..1; null when the source has no notion of confidence (a user's explicit click). */
    confidence: real('confidence'),
    /** The user id, job or model that applied it. */
    actor: text('actor'),

    /** Reason, rationale and evidence behind the label; never message content. */
    metadata: jsonb('metadata').$type<SignalDecisionLabelMetadata>().notNull().default({}),

    createdAt: createdAt(),
  },
  (t) => [index('signal_decision_labels_decision_created_at_idx').on(t.decisionId, t.createdAt)],
);

export const insertSignalDecisionSchema = createInsertSchema(signalDecisions);
export const insertSignalDecisionLabelSchema = createInsertSchema(signalDecisionLabels);

export type NewSignalDecision = typeof signalDecisions.$inferInsert;
export type SignalDecisionItem = typeof signalDecisions.$inferSelect;
export type NewSignalDecisionLabel = typeof signalDecisionLabels.$inferInsert;
export type SignalDecisionLabelItem = typeof signalDecisionLabels.$inferSelect;
