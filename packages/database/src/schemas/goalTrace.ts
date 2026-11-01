import { index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { amountNumeric, createdAt, timestamptz, updatedAt } from './_helpers';
import { goals } from './goal';

/**
 * Execution observation for one goal, one row per goal.
 *
 * Split from `goals` for the same reason `agent_operations` is split from
 * `topics`: a goal is a business entity a user keeps editing — retitled,
 * re-budgeted, paused — while this is an append-only record of what actually
 * happened. Mixing them would let an edit overwrite history.
 *
 * Detail lives in the trajectory object, not here: this table carries scalars
 * and bucket counts for reporting, and `trace_s3_key` points at the advances,
 * their ticks, and the decision surface of each one. That is the same split
 * `agent_operations` makes against its `ExecutionSnapshot`.
 */
export const goalTraces = pgTable(
  'goal_traces',
  {
    goalId: text('goal_id')
      .references(() => goals.id, { onDelete: 'cascade' })
      .primaryKey()
      .notNull(),

    /** Derivable from the goal id, stored so a reader need not know the layout. */
    traceS3Key: text('trace_s3_key'),

    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),
    /** Terminal goal status; null while the goal is still open. */
    finalStatus: text('final_status'),

    // ---- Scale of coordination ----
    advancesTotal: integer('advances_total'),
    ticksTotal: integer('ticks_total'),

    /**
     * `{ create: 1, settle: 112, sweep: 38, manual: 0, decide: 3 }` — answers
     * "how much of this run was the event chain and how much was the safety
     * net" without a row per advance, the way `agent_operations.cost` carries
     * its byModel breakdown.
     */
    advancesByTrigger: jsonb('advances_by_trigger').$type<Record<string, number>>(),
    /** The outcome each advance stopped on. */
    advancesByOutcome: jsonb('advances_by_outcome').$type<Record<string, number>>(),
    /** Which arm of the coordinator ran, across every tick. */
    ticksByBranch: jsonb('ticks_by_branch').$type<Record<string, number>>(),

    // ---- Cost & output ----
    totalCost: amountNumeric('total_cost'),
    /** Operations this goal put in flight — the join count into `agent_operations`. */
    workOperations: integer('work_operations'),

    // ---- Shape the graph ended in ----
    nodesTotal: integer('nodes_total'),
    workResolved: integer('work_resolved'),
    workRetired: integer('work_retired'),
    findingsTotal: integer('findings_total'),

    // ---- Human involvement ----
    gatesOpened: integer('gates_opened'),
    gatesResolved: integer('gates_resolved'),
    /** Wall time parked on a person, summed across gates. */
    humanWaitingMs: integer('human_waiting_ms'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('goal_traces_started_at_idx').on(t.startedAt),
    index('goal_traces_final_status_idx').on(t.finalStatus),
  ],
);

export type NewGoalTrace = typeof goalTraces.$inferInsert;
export type GoalTraceItem = typeof goalTraces.$inferSelect;
