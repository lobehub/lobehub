import { MAX_GOAL_METRIC_CRITERIA } from '@lobechat/types';
import { z } from 'zod';

import { paginatedListSchema } from '../helpers/pagination';
import { dateTimeSchema } from './common.type';
import {
  GoalGraphDecisionSchema,
  GoalGraphEventSchema,
  GoalGraphSchema,
  UpdateGoalBudgetSchema,
} from './goal.type';

/**
 * Schemas for driving a goal past creation: its configuration (budget, agents,
 * models, requirement), hand edits to its graph, the event feed, decision
 * gates and clarifications, measured acceptance clauses, and closing it. Each
 * mirrors the `goal` tRPC procedure the goal page and `lh goal` call.
 */

const comparisonOp = z.enum(['gte', 'lte', 'gt', 'lt', 'eq']);

/** Edge kinds a caller may draw; `revises`, `confirms` and `refutes` stay internal. */
const WritableEdgeKindSchema = z.enum([
  'contains',
  'answers',
  'decomposes',
  'depends_on',
  'derived_from',
  'investigates',
  'produces',
  'supports',
  'contradicts',
  'leads_to',
]);

const ModelConfigSchema = z
  .object({ model: z.string().min(1), provider: z.string().min(1) })
  .strict();

// ==================== Path / Query Schemas ====================

export const GoalDecisionParamSchema = z.object({
  decisionId: z.string().uuid(),
  id: z.string().min(1),
});
export type GoalDecisionParam = z.infer<typeof GoalDecisionParamSchema>;

export const GoalGraphQuerySchema = z.object({
  capabilities: z
    .string()
    .max(512)
    .optional()
    .transform((value) =>
      value
        ?.split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string()).max(20).optional())
    .describe(
      'Comma-separated graph features the client renders (`batch`, `marks`). Node kinds a client does not declare are sent as the kind it already draws.',
    ),
});
export type GoalGraphQuery = z.infer<typeof GoalGraphQuerySchema>;

export const GoalEventListQuerySchema = z.object({
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe("Opaque cursor from the previous page's `nextCursor`. Omit for the first page."),
  entityType: z.enum(['goal', 'node', 'edge', 'decision', 'task']).optional(),
  eventType: z
    .enum([
      'created',
      'updated',
      'activated',
      'resolved',
      'rejected',
      'retired',
      'linked',
      'unlinked',
    ])
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Page size, 1–200. Defaults to 50.'),
});
export type GoalEventListQuery = z.infer<typeof GoalEventListQuerySchema>;

export const GoalDecisionListQuerySchema = z.object({
  status: z
    .enum(['pending', 'resolved', 'canceled'])
    .optional()
    .describe('Only decisions in this state; `pending` lists the gates waiting on a person.'),
});
export type GoalDecisionListQuery = z.infer<typeof GoalDecisionListQuerySchema>;

export const RemoveGoalEdgeQuerySchema = z.object({
  kind: WritableEdgeKindSchema.optional().describe(
    'Omit to remove every edge from source to target.',
  ),
  reason: z.string().max(1000).optional(),
  sourceNodeId: z.string().uuid(),
  targetNodeId: z.string().uuid(),
});
export type RemoveGoalEdgeQuery = z.infer<typeof RemoveGoalEdgeQuerySchema>;

export const RemoveGoalMetricsQuerySchema = z.object({
  keys: z
    .string()
    .min(1)
    .max(4096)
    .transform((value) =>
      value
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().min(1).max(255)).min(1))
    .describe('Comma-separated clause keys to drop.'),
});
export type RemoveGoalMetricsQuery = z.infer<typeof RemoveGoalMetricsQuerySchema>;

// ==================== Request Schemas ====================

/**
 * One patch over the goal's configuration. Every part is optional and applied
 * together: a part the goal cannot take (say `maxManagerTurns` on a goal with
 * no main Agent) refuses the whole patch and leaves the goal unchanged.
 */
export const UpdateGoalConfigRequestSchema = z
  .object({
    /** Hand the goal to another agent, the one that supervises and plans it. */
    agent: z
      .object({
        agentId: z.string().min(1),
        /** Keep unfinished Tasks on their current agent. */
        goalOnly: z.boolean().optional(),
      })
      .strict()
      .optional(),
    budget: UpdateGoalBudgetSchema.strict().optional(),
    /** The model the goal agent plans with; `null` falls back to the agent's own. */
    model: ModelConfigSchema.nullable().optional(),
    /** Rewrites the "what counts as done" text every task's context reads. */
    requirement: z.string().min(1).optional(),
    /** Route the goal's Tasks to a dedicated executor; `agentId: null` hands them back. */
    taskAgent: z
      .object({
        agentId: z.string().min(1).nullable(),
        goalOnly: z.boolean().optional(),
      })
      .strict()
      .optional(),
    /** The model the goal's Tasks run on; `null` falls back to their executor's own. */
    taskModel: ModelConfigSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((part) => part !== undefined), {
    message: 'Provide at least one configuration field',
  });
export type UpdateGoalConfigRequest = z.infer<typeof UpdateGoalConfigRequestSchema>;

export const AddGoalNodeRequestSchema = z
  .object({
    description: z.string().optional(),
    kind: z.enum(['problem', 'experiment', 'task', 'finding', 'decision']),
    priority: z.number().int().optional(),
    /** The question this node answers. */
    questionId: z.string().uuid().optional(),
    /** The container (problem or experiment) the node sits in. */
    scopeId: z.string().uuid().optional(),
    status: z.enum(['proposed', 'active', 'waiting', 'resolved', 'rejected', 'retired']).optional(),
    title: z.string().min(1),
  })
  .strict();
export type AddGoalNodeRequest = z.infer<typeof AddGoalNodeRequestSchema>;

export const RetireGoalNodesRequestSchema = z
  .object({
    /** Task nodes to retire as one set; unfinished dependents must be in it too. */
    nodeIds: z.array(z.string().uuid()).min(1),
    reason: z.string().optional(),
  })
  .strict();
export type RetireGoalNodesRequest = z.infer<typeof RetireGoalNodesRequestSchema>;

export const AddGoalEdgeRequestSchema = z
  .object({
    kind: WritableEdgeKindSchema,
    sourceNodeId: z.string().uuid(),
    targetNodeId: z.string().uuid(),
  })
  .strict();
export type AddGoalEdgeRequest = z.infer<typeof AddGoalEdgeRequestSchema>;

export const DecideGoalRequestSchema = z
  .object({
    /** One of the decision's `options[].id`. */
    optionId: z.string().min(1),
    /** Free-text note recorded with the answer. */
    resolution: z.string().optional(),
  })
  .strict();
export type DecideGoalRequest = z.infer<typeof DecideGoalRequestSchema>;

export const AnswerGoalClarificationsRequestSchema = z
  .object({
    /** Answer the whole clarification round at once; one re-plan follows them all. */
    answers: z
      .array(
        z
          .object({
            decisionId: z.string().uuid(),
            optionId: z.string().min(1),
            resolution: z.string().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type AnswerGoalClarificationsRequest = z.infer<typeof AnswerGoalClarificationsRequestSchema>;

export const SetGoalMetricsRequestSchema = z
  .object({
    metrics: z
      .array(
        z
          .object({
            key: z.string().min(1).max(255),
            op: comparisonOp.optional().describe('Defaults to `gte`.'),
            target: z.number(),
            title: z.string().max(255).optional(),
          })
          .strict(),
      )
      .max(MAX_GOAL_METRIC_CRITERIA),
    /** `merge` upserts by key into the stored list; `replace` (default) swaps it. */
    mode: z.enum(['merge', 'replace']).optional(),
  })
  .strict();
export type SetGoalMetricsRequest = z.infer<typeof SetGoalMetricsRequestSchema>;

export const RecordGoalObservationRequestSchema = z
  .object({
    key: z.string().min(1).max(255),
    kind: z.enum(['gauge', 'counter']).optional(),
    /** When the value was measured; defaults to now. */
    observedAt: z.string().datetime().optional(),
    title: z.string().optional(),
    unit: z.string().optional(),
    value: z.number(),
  })
  .strict();
export type RecordGoalObservationRequest = z.infer<typeof RecordGoalObservationRequestSchema>;

export const CloseGoalRequestSchema = z
  .object({ status: z.enum(['achieved', 'canceled']) })
  .strict();
export type CloseGoalRequest = z.infer<typeof CloseGoalRequestSchema>;

// ==================== Response Schemas ====================

export const GoalConfigUpdateResultSchema = z
  .object({
    graph: GoalGraphSchema,
    /** Unfinished Tasks moved to the new goal or task agent. */
    reassignedTaskIds: z.array(z.string()),
  })
  .strict()
  .meta({ id: 'GoalConfigUpdateResult' });

export const GoalEventListSchema = paginatedListSchema(GoalGraphEventSchema, {
  key: 'events',
}).meta({ id: 'GoalEventList' });

export const GoalDecisionListSchema = z.array(GoalGraphDecisionSchema);

export const GoalRetiredNodesSchema = z
  .object({ retiredNodeIds: z.array(z.string()) })
  .strict()
  .meta({ id: 'GoalRetiredNodes' });

export const GoalRemovedEdgesSchema = z
  .object({ edgeIds: z.array(z.string()) })
  .strict()
  .meta({ id: 'GoalRemovedEdges' });

export const GoalMetricStateSchema = z
  .object({
    /** Every declared clause holds (true when none is declared). */
    allMet: z.boolean(),
    criteria: z.array(
      z
        .object({
          key: z.string(),
          met: z.boolean(),
          /** Epoch milliseconds of the observation read; absent when nothing was measured. */
          observedAt: z.number().optional(),
          op: z.string(),
          target: z.number(),
          title: z.string().optional(),
          value: z.number().nullable(),
        })
        .strict(),
    ),
  })
  .strict()
  .meta({ id: 'GoalMetricState' });

export const GoalObservationSchema = z
  .object({
    /** The coordinator was woken because this measurement cleared the gate. */
    advanced: z.boolean(),
    key: z.string(),
    metricId: z.string(),
    observedAt: dateTimeSchema,
    pointId: z.string(),
    value: z.number(),
  })
  .strict()
  .meta({ id: 'GoalObservation' });

// ==================== Inferred Types ====================

export type GoalMetricState = z.infer<typeof GoalMetricStateSchema>;
export type GoalObservation = z.infer<typeof GoalObservationSchema>;
