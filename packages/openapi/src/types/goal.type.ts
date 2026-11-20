import type { GoalMetricCriteriaState } from '@lobechat/agent-tracing';
import type {
  AcceptanceStatus,
  GoalDecisionAuthority,
  GoalDecisionOption,
  GoalDecisionOptionEffect,
  GoalDecisionStatus,
  GoalEdgeKind,
  GoalEventActorType,
  GoalEventEntityType,
  GoalEventType,
  GoalGraphDecision,
  GoalGraphEdge,
  GoalGraphEvent,
  GoalGraphNode,
  GoalGraphSnapshot,
  GoalGraphWorkVersionDisplay,
  GoalGraphWorkVersionLink,
  GoalNodeAcceptance,
  GoalNodeKind,
  GoalNodeStatus,
  GoalNodeWorkVersionRelation,
  GoalReportState,
  GoalReportStatus,
  GoalReportTrigger,
  GoalSpend,
  GoalSupervisionIncident,
  GoalSupervisionState,
  GoalTickOutcome,
  GoalTickResult,
  VerifyCheckTally,
  WorkResourceType,
  WorkType,
} from '@lobechat/types';
import { GOAL_VISIBILITIES, GoalReportMetadataSchema } from '@lobechat/types';
import { z } from 'zod';

import { goalStatuses, goalSubjectTypes } from '@/const/goal';
import type { GoalListItem } from '@/database/models/goal';
import type { GoalItem as GoalRow } from '@/database/schemas';

import {
  CursorPaginationQuerySchema,
  legacyOffsetQueryShape,
  pageInfoShape,
  totalShape,
} from '../helpers/pagination';
import { dateTimeSchema, jsonObjectSchema } from './common.type';

// ==================== Path / Query Schemas ====================

export const GoalIdParamSchema = z.object({
  id: z.string().min(1),
});
export type GoalIdParam = z.infer<typeof GoalIdParamSchema>;

/**
 * Query strings cannot carry repeated/typed values the way the tRPC surface can,
 * so list filters arrive as strings: numbers are coerced and `statuses` is a
 * comma-separated list (`?statuses=running,paused`).
 */
export const GoalListQuerySchema = z.object({
  agentId: z.string().optional(),
  ...CursorPaginationQuerySchema.shape,
  ...legacyOffsetQueryShape,
  projectId: z.string().optional(),
  statuses: z
    .string()
    .optional()
    .transform((value) =>
      value
        ?.split(',')
        .map((status) => status.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(goalStatuses)).optional()),
  topicId: z.string().optional(),
});
export type GoalListQuery = z.infer<typeof GoalListQuerySchema>;

// ==================== Request Body Schemas ====================

export const GoalCriterionSchema = z.object({
  description: z.string().optional(),
  instruction: z.string().optional(),
  title: z.string().min(1),
});

export const GoalTaskSeedSchema = z.union([
  z.string().min(1),
  z.object({
    description: z.string().optional(),
    title: z.string().min(1),
  }),
]);

export const CreateGoalRequestSchema = z.object({
  /** The agent that supervises the goal; defaults to the authoring agent. */
  agentId: z.string().optional(),
  /** Coordinator config (budget, concurrency, task agent, acceptance metrics…). */
  config: z.record(z.string(), z.unknown()).optional(),
  /** Structured acceptance criteria, persisted as verify criteria rows. */
  criteria: z.array(GoalCriterionSchema).optional(),
  /** Calendar deadline for the whole goal, ISO-8601. */
  deadline: z.string().datetime().optional(),
  /** Cap on total spend in USD. */
  maxTotalCost: z.number().positive().optional(),
  problemDescription: z.string().optional(),
  projectId: z.string().optional(),
  requirement: z.string().optional(),
  /** Seed task nodes. Omit to let the coordinator plan the decomposition. */
  tasks: z.array(GoalTaskSeedSchema).optional(),
  title: z.string().min(1),
});
export type CreateGoalRequest = z.infer<typeof CreateGoalRequestSchema>;

/**
 * Budget knobs mirror the `lh goal set-budget` surface: `null` clears a bound,
 * omitting it leaves the current value in place.
 */
export const UpdateGoalBudgetSchema = z.object({
  deadline: z.string().datetime().nullable().optional(),
  maxAttemptsPerTask: z.number().int().positive().optional(),
  maxConcurrentTasks: z.number().int().min(1).max(10).nullable().optional(),
  maxExperiments: z.number().int().min(1).max(200).optional(),
  maxManagerTurns: z.number().int().min(1).max(100).optional(),
  maxRounds: z.number().int().positive().nullable().optional(),
  maxStepsPerRun: z.number().int().positive().nullable().optional(),
  maxTotalCost: z.number().positive().nullable().optional(),
});
export type UpdateGoalBudget = z.infer<typeof UpdateGoalBudgetSchema>;

export const UpdateGoalRequestSchema = z
  .object({
    budget: UpdateGoalBudgetSchema.optional(),
    /** Rewrites the "what counts as done" text every task's context reads. */
    requirement: z.string().min(1).optional(),
  })
  .refine((value) => value.budget !== undefined || value.requirement !== undefined, {
    message: 'Provide at least one of `requirement` or `budget`',
  });
export type UpdateGoalRequest = z.infer<typeof UpdateGoalRequestSchema>;

export const RestartGoalRequestSchema = z.object({
  /** Optional new agent for every unfinished task node. */
  agentId: z.string().min(1).optional(),
});
export type RestartGoalRequest = z.infer<typeof RestartGoalRequestSchema>;

// ==================== Response Schemas ====================

/**
 * A `z.enum` over a TS string union that fails to compile when the union gains
 * a member the list does not name, so the documented vocabulary cannot drift
 * from the one the coordinator writes.
 */
const unionEnum =
  <T extends string>() =>
  <const A extends readonly [T, ...T[]]>(
    values: A &
      ([Exclude<T, A[number]>] extends [never] ? unknown : { missing: Exclude<T, A[number]> }),
  ) =>
    z.enum(values);

const GoalNodeKindSchema = unionEnum<GoalNodeKind>()([
  'problem',
  'experiment',
  'task',
  'finding',
  'decision',
  'batch',
  'pattern',
  'tool',
  'hazard',
  'dead_end',
  'template',
]);
const GoalNodeStatusSchema = unionEnum<GoalNodeStatus>()([
  'proposed',
  'active',
  'waiting',
  'resolved',
  'rejected',
  'retired',
]);
const GoalEdgeKindSchema = unionEnum<GoalEdgeKind>()([
  'contains',
  'answers',
  'decomposes',
  'depends_on',
  'derived_from',
  'revises',
  'investigates',
  'produces',
  'supports',
  'contradicts',
  'leads_to',
  'confirms',
  'refutes',
]);
const GoalDecisionAuthoritySchema = unionEnum<GoalDecisionAuthority>()([
  'agent',
  'user',
  'project_role',
]);
const GoalDecisionStatusSchema = unionEnum<GoalDecisionStatus>()([
  'pending',
  'resolved',
  'canceled',
]);
const GoalEventTypeSchema = unionEnum<GoalEventType>()([
  'created',
  'updated',
  'activated',
  'resolved',
  'rejected',
  'retired',
  'linked',
  'unlinked',
]);
const GoalEventEntityTypeSchema = unionEnum<GoalEventEntityType>()([
  'goal',
  'node',
  'edge',
  'decision',
  'task',
]);
const GoalEventActorTypeSchema = unionEnum<GoalEventActorType>()(['agent', 'user', 'system']);
const GoalNodeWorkVersionRelationSchema = unionEnum<GoalNodeWorkVersionRelation>()([
  'input',
  'produced',
  'supports',
  'contradicts',
]);
const WorkTypeSchema = unionEnum<WorkType>()([
  'canvas',
  'document',
  'external',
  'file',
  'goal_report',
  'task',
]);
const WorkResourceTypeSchema = unionEnum<WorkResourceType>()([
  'canvas',
  'document',
  'github_issue',
  'github_pull_request',
  'linear_document',
  'linear_issue',
  'file',
  'goal_report',
  'task',
]);
const AcceptanceStatusSchema = unionEnum<AcceptanceStatus>()([
  'pending',
  'planned',
  'verifying',
  'repairing',
  'delivered',
  'accepted',
  'closed',
  'rejected',
  'errored',
]);

/** A `goals` row exactly as `select()` reads it (soft-delete columns included). */
export const GoalSchema = z
  .object({
    agentId: z.string().nullable(),
    archivedAt: dateTimeSchema.nullable(),
    completedAt: dateTimeSchema.nullable(),
    /**
     * Coordinator-owned runtime policy and state (budget, supervision, manager
     * and rollout pockets). Its keys move with the coordinator, so it is
     * documented as an open JSON object rather than pinned here.
     */
    config: jsonObjectSchema.nullable(),
    createdAt: dateTimeSchema,
    deletedAt: dateTimeSchema.nullable(),
    id: z.string(),
    isDeleted: z.boolean().nullable(),
    maxRounds: z.number().int().nullable(),
    maxTotalCost: z.number().nullable(),
    projectId: z.string().nullable(),
    requirement: z.string().nullable(),
    startedAt: dateTimeSchema.nullable(),
    status: z.enum(goalStatuses),
    subjectId: z.string().nullable(),
    subjectType: z.enum(goalSubjectTypes).nullable(),
    title: z.string(),
    updatedAt: dateTimeSchema,
    userId: z.string(),
    visibility: z.enum(GOAL_VISIBILITIES),
    workspaceId: z.string().nullable(),
  } satisfies Record<keyof GoalRow, z.ZodType>)
  .strict()
  .meta({ id: 'Goal' });

/** One goal-list row: the goal plus the graph roll-up the list renders. */
export const GoalListItemSchema = z
  .object({
    findingCount: z.number().int(),
    goal: GoalSchema,
    /** Decision gates waiting on a human right now. */
    pendingDecisions: z.number().int(),
    /** Achieved and accepted by its owner. */
    signedOff: z.boolean(),
    /** Task nodes in a terminal status (resolved / rejected / retired). */
    taskDone: z.number().int(),
    taskTotal: z.number().int(),
    totalRunCost: z.number(),
    /** Milliseconds across every finished run. */
    totalRunDuration: z.number(),
  } satisfies Record<keyof GoalListItem, z.ZodType>)
  .strict()
  .meta({ id: 'GoalListItem' });

export const GoalListResponseSchema = z
  .object({ ...pageInfoShape, goals: z.array(GoalListItemSchema), ...totalShape })
  .strict()
  .meta({ id: 'GoalList' });

export const GoalGraphNodeSchema = z
  .object({
    accessedAt: dateTimeSchema,
    /** Numeric(4,3) confidence from 0 to 1, serialized as a decimal string. */
    confidence: z.string().nullable(),
    createdAt: dateTimeSchema,
    createdByAgentId: z.string().nullable(),
    createdByUserId: z.string().nullable(),
    description: z.string().nullable(),
    goalId: z.string(),
    id: z.string(),
    kind: GoalNodeKindSchema,
    priority: z.number().int(),
    resolvedAt: dateTimeSchema.nullable(),
    status: GoalNodeStatusSchema,
    taskId: z.string().nullable(),
    title: z.string(),
    updatedAt: dateTimeSchema,
  } satisfies Record<keyof GoalGraphNode | 'accessedAt', z.ZodType>)
  .strict()
  .meta({ id: 'GoalGraphNode' });

export const GoalGraphEdgeSchema = z
  .object({
    createdAt: dateTimeSchema,
    goalId: z.string(),
    id: z.string(),
    kind: GoalEdgeKindSchema,
    sourceNodeId: z.string(),
    targetNodeId: z.string(),
  } satisfies Record<keyof GoalGraphEdge, z.ZodType>)
  .strict()
  .meta({ id: 'GoalGraphEdge' });

export const GoalDecisionOptionSchema = z
  .object({
    /** Unfinished tasks a `retire` effect takes along. */
    alsoRetires: z.array(z.object({ nodeId: z.string(), title: z.string() }).strict()).optional(),
    description: z.string().optional(),
    effect: unionEnum<GoalDecisionOptionEffect>()([
      'retry',
      'retire',
      'retry_after_reset',
    ]).optional(),
    id: z.string(),
    label: z.string(),
  } satisfies Record<keyof GoalDecisionOption, z.ZodType>)
  .strict()
  .meta({ id: 'GoalDecisionOption' });

export const GoalGraphDecisionSchema = z
  .object({
    accessedAt: dateTimeSchema,
    authority: GoalDecisionAuthoritySchema,
    canceledAt: dateTimeSchema.nullable(),
    createdAt: dateTimeSchema,
    id: z.string(),
    nodeId: z.string(),
    options: z.array(GoalDecisionOptionSchema).nullable(),
    question: z.string(),
    recommendedOptionId: z.string().nullable(),
    requestedProjectRole: z.string().nullable(),
    requestedUserId: z.string().nullable(),
    resolution: z.string().nullable(),
    resolvedAt: dateTimeSchema.nullable(),
    resolvedByAgentId: z.string().nullable(),
    resolvedByUserId: z.string().nullable(),
    resolvedOptionId: z.string().nullable(),
    status: GoalDecisionStatusSchema,
    updatedAt: dateTimeSchema,
  } satisfies Record<keyof GoalGraphDecision | 'accessedAt', z.ZodType>)
  .strict()
  .meta({ id: 'GoalGraphDecision' });

export const GoalGraphEventSchema = z
  .object({
    actorId: z.string().nullable(),
    actorType: GoalEventActorTypeSchema,
    createdAt: dateTimeSchema,
    entityId: z.string(),
    entityType: GoalEventEntityTypeSchema,
    eventType: GoalEventTypeSchema,
    goalId: z.string(),
    id: z.string(),
    operationId: z.string().nullable(),
    reason: z.string().nullable(),
    taskId: z.string().nullable(),
  } satisfies Record<keyof GoalGraphEvent, z.ZodType>)
  .strict()
  .meta({ id: 'GoalGraphEvent' });

const GoalGraphWorkVersionDisplaySchema = z
  .object({
    agentDocumentId: z.string().optional(),
    fileId: z.string().optional(),
    fileSize: z.number().optional(),
    fileUrl: z.string().optional(),
    identifier: z.string().nullable(),
    mimeType: z.string().optional(),
    resourceId: z.string().nullable(),
    resourceType: WorkResourceTypeSchema.optional(),
    status: z.string().nullable(),
    title: z.string().nullable(),
    type: WorkTypeSchema,
    url: z.string().nullable(),
    workId: z.string(),
  } satisfies Record<keyof GoalGraphWorkVersionDisplay, z.ZodType>)
  .strict();

export const GoalGraphWorkVersionLinkSchema = z
  .object({
    createdAt: dateTimeSchema,
    id: z.string(),
    nodeId: z.string(),
    relation: GoalNodeWorkVersionRelationSchema,
    /** Display snapshot of the linked version; absent only when the version row is gone. */
    work: GoalGraphWorkVersionDisplaySchema.optional(),
    workVersionId: z.string(),
  } satisfies Record<keyof GoalGraphWorkVersionLink, z.ZodType>)
  .strict()
  .meta({ id: 'GoalGraphWorkVersionLink' });

const GoalNodeAcceptanceSchema = z
  .object({
    checks: z
      .object({
        failed: z.number().int(),
        passed: z.number().int(),
        total: z.number().int(),
        unjudged: z.number().int(),
      } satisfies Record<keyof VerifyCheckTally, z.ZodType>)
      .strict()
      .optional(),
    id: z.string(),
    status: AcceptanceStatusSchema,
  } satisfies Record<keyof GoalNodeAcceptance, z.ZodType>)
  .strict();

const GoalReportStateSchema = z
  .object({
    dispatch: z
      .object({
        acceptanceKey: z.string(),
        dispatchedAt: dateTimeSchema,
        error: z.string().optional(),
        nodeId: z.string(),
        operationId: z.string().optional(),
        taskId: z.string().optional(),
        trigger: unionEnum<GoalReportTrigger>()([
          'accepted',
          'acceptance_failed',
          'goal_canceled',
          'goal_failed',
        ]),
      } satisfies Record<keyof GoalReportState['dispatch'], z.ZodType>)
      .strict(),
    latest: z
      .object({
        content: z.string().nullable(),
        createdAt: dateTimeSchema,
        metadata: GoalReportMetadataSchema,
        pageDocumentId: z.string().optional(),
        version: z.number().int(),
        workId: z.string(),
        workVersionId: z.string(),
      } satisfies Record<keyof NonNullable<GoalReportState['latest']>, z.ZodType>)
      .strict()
      .optional(),
    status: unionEnum<GoalReportStatus>()(['completed', 'failed', 'running']),
  } satisfies Record<keyof GoalReportState, z.ZodType>)
  .strict();

const GoalSpendSchema = z
  .object({
    byTask: z.array(
      z
        .object({
          runs: z.number().int(),
          taskId: z.string(),
          totalCost: z.number(),
          totalInputTokens: z.number(),
          totalOutputTokens: z.number(),
          totalTokens: z.number(),
        })
        .strict(),
    ),
    runs: z.number().int(),
    /** USD across the Task runs plus the supervisor's and manager's own runs. */
    totalCost: z.number(),
    /** Input tokens across the Task runs only. */
    totalInputTokens: z.number(),
    /** Output tokens across the Task runs only. */
    totalOutputTokens: z.number(),
    totalTokens: z.number(),
  } satisfies Record<keyof GoalSpend | 'totalInputTokens' | 'totalOutputTokens', z.ZodType>)
  .strict();

const GoalMetricCriteriaStateSchema = z
  .object({
    allMet: z.boolean(),
    criteria: z.array(
      z
        .object({
          key: z.string(),
          met: z.boolean(),
          /** Epoch milliseconds of the recorded observation; absent when nothing was measured. */
          observedAt: z.number().optional(),
          op: z.string(),
          target: z.number(),
          value: z.number().nullable(),
        } satisfies Record<keyof GoalMetricCriteriaState['criteria'][number], z.ZodType>)
        .strict(),
    ),
  } satisfies Record<keyof GoalMetricCriteriaState, z.ZodType>)
  .strict();

const graphShape = {
  decisions: z.array(GoalGraphDecisionSchema),
  edges: z.array(GoalGraphEdgeSchema),
  /** The newest graph events (capped); page older ones through the event feed. */
  events: z.array(GoalGraphEventSchema),
  goal: GoalSchema,
  nodes: z.array(GoalGraphNodeSchema),
  workVersions: z.array(GoalGraphWorkVersionLinkSchema),
};

/**
 * The graph a write returns: the goal, its nodes, edges, decisions, events and
 * linked Work versions, without the read-time roll-ups.
 */
export const GoalGraphSnapshotSchema = z
  .object(graphShape)
  .strict()
  .meta({ id: 'GoalGraphSnapshot' });

/** A fetched graph: the snapshot plus the per-node live state and roll-ups `graph()` attaches. */
export const GoalGraphSchema = z
  .object({
    ...graphShape,
    /** Verification state per task node id. */
    acceptances: z.record(z.string(), GoalNodeAcceptanceSchema).optional(),
    /** Agent each dispatched task node is assigned to, keyed by node id. */
    assignees: z.record(z.string(), z.string()).optional(),
    /** When an active node's newest run delivered, while it waits on verification. */
    deliveredAt: z.record(z.string(), dateTimeSchema).optional(),
    /** Numeric acceptance clauses as they read now. */
    metricCriteria: GoalMetricCriteriaStateSchema,
    /** When the coordinator retries each node a usage window refused. */
    quotaRetryAt: z.record(z.string(), dateTimeSchema).optional(),
    /** The wrap-up report state; absent until a wrap-up was dispatched. */
    report: GoalReportStateSchema.optional(),
    /** Live run heartbeat per active task node id. */
    runHeartbeats: z.record(z.string(), dateTimeSchema).optional(),
    spend: GoalSpendSchema,
  } satisfies Record<keyof GoalGraphSnapshot | 'metricCriteria', z.ZodType>)
  .strict()
  .meta({ id: 'GoalGraph' });

const GoalSupervisionIncidentSchema = z
  .object({
    createdAt: dateTimeSchema,
    eligible: z.boolean(),
    failedOperationId: z.string(),
    id: z.string(),
    inspected: z
      .object({
        artifactVersionIds: z.array(z.string()).optional(),
        goal: z.boolean().optional(),
        task: z.boolean().optional(),
      })
      .strict()
      .optional(),
    nodeId: z.string(),
    reason: z.string(),
    recoveryInstruction: z.string().optional(),
    recoveryOperationId: z.string().optional(),
    resolution: z
      .object({
        action: z.enum(['retry', 'escalate']),
        instruction: z.string(),
        reason: z.string(),
        toolCallId: z.string(),
      })
      .strict()
      .optional(),
    resolvedAt: dateTimeSchema.optional(),
    status: z.enum([
      'diagnosing',
      'retrying',
      'recovered',
      'escalated',
      'unsuccessful',
      'human_resumed',
    ]),
    supervisorOperationId: z.string().optional(),
    taskId: z.string(),
    taskStatus: z.string().optional(),
  } satisfies Record<keyof GoalSupervisionIncident, z.ZodType>)
  .strict();

export const GoalSupervisionSchema = z
  .object({
    /** Whether the recovery supervisor runs for this goal. */
    enabled: z.boolean(),
    /** Supervisor topic and incident ledger; absent until the supervisor first ran. */
    state: z
      .object({
        agentId: z.string(),
        incidents: z.array(GoalSupervisionIncidentSchema),
        revision: z.number().int(),
        topicId: z.string(),
      } satisfies Record<keyof GoalSupervisionState, z.ZodType>)
      .strict()
      .optional(),
  })
  .strict()
  .meta({ id: 'GoalSupervision' });

/** Where a manual advance stopped: the last coordinator tick plus how many ran. */
export const GoalAdvanceResultSchema = z
  .object({
    goalId: z.string(),
    message: z.string(),
    nodeId: z.string().optional(),
    outcome: unionEnum<GoalTickOutcome>()([
      'advanced',
      'achieved',
      'waiting_human',
      'waiting_external',
      'no_progress',
      'failed',
    ]),
    taskId: z.string().optional(),
    /** Coordinator ticks this call ran before it stopped. */
    ticks: z.number().int(),
  } satisfies Record<keyof GoalTickResult | 'ticks', z.ZodType>)
  .strict()
  .meta({ id: 'GoalAdvanceResult' });

export const GoalRestartResultSchema = z
  .object({
    goal: GoalSchema,
    /** Task ids put back to `backlog` for the coordinator to dispatch afresh. */
    restartedTaskIds: z.array(z.string()),
  })
  .strict()
  .meta({ id: 'GoalRestartResult' });
