import { TASK_STATUSES } from '@lobechat/builtin-tool-task';
import type {
  ChatFileItem,
  CheckpointConfig,
  ExecAgentResult,
  TaskDetailActivity,
  TaskDetailActivityAgent,
  TaskDetailActivityAuthor,
  TaskDetailData,
  TaskDetailSubtask,
  TaskDetailWorkspaceNode,
  TaskItem,
  TaskLabelRef,
  TaskRunVerifySummary,
  TaskVerifyConfig,
} from '@lobechat/types';
import { z } from 'zod';

import {
  schedulePatternSchema,
  scheduleTimezoneSchema,
} from '@/server/services/task/scheduleValidation';

import {
  CursorPaginationQuerySchema,
  legacyOffsetQueryShape,
  pageInfoShape,
  totalShape,
} from '../helpers/pagination';
import { dateTimeSchema, jsonObjectSchema } from './common.type';

export const TaskIdParamSchema = z.object({
  id: z.string().min(1),
});
export type TaskIdParam = z.infer<typeof TaskIdParamSchema>;

/** Query strings carry lists as comma-separated text: `?statuses=running,paused`. */
export const TaskListQuerySchema = z.object({
  assigneeAgentId: z.string().optional(),
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
    .pipe(z.array(z.enum(TASK_STATUSES)).optional()),
});
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;

export const CreateTaskRequestSchema = z.object({
  assigneeAgentId: z.string().optional(),
  assigneeUserId: z.string().optional(),
  automationMode: z.enum(['heartbeat', 'schedule']).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  createdByAgentId: z.string().optional(),
  description: z.string().optional(),
  /** What the task must accomplish; the only required field. */
  instruction: z.string().min(1),
  name: z.string().optional(),
  parentTaskId: z.string().optional(),
  priority: z.number().int().min(0).max(4).optional(),
  projectId: z.string().optional(),
  // Same write-time cron/timezone validation as the tRPC create boundary, so a
  // schedule the dispatcher cannot evaluate is refused instead of stored.
  schedulePattern: schedulePatternSchema.optional(),
  scheduleTimezone: scheduleTimezoneSchema.optional(),
  visibility: z.enum(['private', 'public']).optional(),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

export const UpdateTaskRequestSchema = z
  .object({
    assigneeAgentId: z.string().nullish(),
    assigneeUserId: z.string().nullish(),
    automationMode: z.enum(['heartbeat', 'schedule']).nullish(),
    config: z.record(z.string(), z.unknown()).optional(),
    description: z.string().nullish(),
    // Same bound as the in-app editor and the tRPC patch: 0 turns the heartbeat
    // off, anything else is at least 10 minutes so a client cannot spin ticks.
    heartbeatInterval: z
      .number()
      .int()
      .refine((value) => value === 0 || value >= 600, {
        message: 'heartbeatInterval must be 0 (disabled) or at least 600 seconds (10 minutes)',
      })
      .optional(),
    instruction: z.string().optional(),
    name: z.string().optional(),
    parentTaskId: z.string().nullish(),
    priority: z.number().int().min(0).max(4).optional(),
    // `null` takes the task out of its project; omitted leaves it untouched.
    projectId: z.string().nullish(),
    schedulePattern: schedulePatternSchema.nullish(),
    scheduleTimezone: scheduleTimezoneSchema.nullish(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;

export const UpdateTaskStatusRequestSchema = z.object({
  /** Only meaningful with `failed`; rejected otherwise. */
  error: z.string().optional(),
  status: z.enum(TASK_STATUSES),
});
export type UpdateTaskStatusRequest = z.infer<typeof UpdateTaskStatusRequestSchema>;

export const RunTaskRequestSchema = z
  .object({
    /** Added to this run's prompt only; the task's own instruction is left unchanged. */
    prompt: z.string().min(1).optional(),
  })
  .strict();
export type RunTaskRequest = z.infer<typeof RunTaskRequestSchema>;

export const TaskRunListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type TaskRunListQuery = z.infer<typeof TaskRunListQuerySchema>;

// ==================== Response Schemas ====================

const TaskAutomationModeSchema = z.enum(['heartbeat', 'schedule']);
const TaskRunTriggerSchema = z.enum(['manual', 'schedule', 'heartbeat', 'goal']);
const TaskVisibilitySchema = z.enum(['private', 'public']);

export const TaskLabelRefSchema = z
  .object({
    color: z.string().nullable().optional(),
    id: z.string(),
    name: z.string(),
    parentId: z.string().nullable().optional(),
  } satisfies Record<keyof TaskLabelRef, z.ZodType>)
  .strict()
  .meta({ id: 'TaskLabelRef' });

const taskRowShape = {
  accessedAt: dateTimeSchema,
  archivedAt: dateTimeSchema.nullable(),
  assigneeAgentId: z.string().nullable(),
  assigneeUserId: z.string().nullable(),
  automationMode: TaskAutomationModeSchema.nullable(),
  completedAt: dateTimeSchema.nullable(),
  /** Task configuration pockets (checkpoint, verify, execution, model…), stored as JSON. */
  config: jsonObjectSchema.nullable(),
  /** Runtime state pockets (scheduler, lifecycle audit, origin), stored as JSON. */
  context: jsonObjectSchema.nullable(),
  createdAt: dateTimeSchema,
  createdByAgentId: z.string().nullable(),
  createdByUserId: z.string(),
  currentTopicId: z.string().nullable(),
  deletedAt: dateTimeSchema.nullable(),
  description: z.string().nullable(),
  /** Rich-editor JSON state of the instruction. */
  editorData: z.unknown(),
  error: z.string().nullable(),
  heartbeatInterval: z.number().int().nullable(),
  heartbeatTimeout: z.number().int().nullable(),
  id: z.string(),
  /** Display identifier, e.g. `T-12`. */
  identifier: z.string(),
  instruction: z.string(),
  isDeleted: z.boolean().nullable(),
  lastHeartbeatAt: dateTimeSchema.nullable(),
  maxTopics: z.number().int().nullable(),
  name: z.string().nullable(),
  parentTaskId: z.string().nullable(),
  priority: z.number().int().nullable(),
  projectId: z.string().nullable(),
  schedulePattern: z.string().nullable(),
  scheduleTimezone: z.string().nullable(),
  seq: z.number().int(),
  sortOrder: z.number().int().nullable(),
  startedAt: dateTimeSchema.nullable(),
  status: z.enum(TASK_STATUSES),
  totalTopics: z.number().int().nullable(),
  updatedAt: dateTimeSchema,
  visibility: TaskVisibilitySchema,
  workspaceId: z.string().nullable(),
};

/**
 * A `tasks` row exactly as the model reads or writes it. The read-time extras
 * on `TaskItem` (labels, progress, run totals) are only attached by list reads.
 */
export const TaskSchema = z
  .object(
    taskRowShape satisfies Record<
      | Exclude<keyof TaskItem, 'labels' | 'subtaskProgress' | 'totalRunCost' | 'totalRunDuration'>
      | 'deletedAt'
      | 'isDeleted',
      z.ZodType
    >,
  )
  .strict()
  .meta({ id: 'Task' });

export const TaskListItemSchema = z
  .object({
    ...taskRowShape,
    labels: z.array(TaskLabelRefSchema),
    /** Recursive descendant progress; absent for a task without subtasks. */
    subtaskProgress: z
      .object({ completed: z.number().int(), total: z.number().int() })
      .strict()
      .optional(),
  })
  .strict()
  .meta({ id: 'TaskListItem' });

export const TaskListResponseSchema = z
  .object({ ...pageInfoShape, tasks: z.array(TaskListItemSchema), ...totalShape })
  .strict()
  .meta({ id: 'TaskList' });

const ChatFileItemSchema = z
  .object({
    content: z.string().optional(),
    downloadUrl: z.string().optional(),
    fileType: z.string(),
    id: z.string(),
    /** The viewer lost access to the file; the row is a tombstone. */
    inaccessible: z.boolean().optional(),
    name: z.string(),
    originalCharCount: z.number().int().optional(),
    size: z.number(),
    url: z.string(),
  } satisfies Record<keyof ChatFileItem, z.ZodType>)
  .strict();

const CheckpointTaskRefSchema = z.object({ id: z.string(), identifier: z.string() }).strict();

const CheckpointConfigSchema = z
  .object({
    onAgentRequest: z.boolean().optional(),
    tasks: z
      .object({
        afterIds: z.array(z.string()).optional(),
        afterTasks: z.array(CheckpointTaskRefSchema).optional(),
        beforeIds: z.array(z.string()).optional(),
        beforeTasks: z.array(CheckpointTaskRefSchema).optional(),
      })
      .strict()
      .optional(),
    topic: z
      .object({ after: z.boolean().optional(), before: z.boolean().optional() })
      .strict()
      .optional(),
  } satisfies Record<keyof CheckpointConfig, z.ZodType>)
  .strict();

const TaskVerifyConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    maxIterations: z.number().int().optional(),
    requirement: z.string().optional(),
    verifierAgentId: z.string().optional(),
    verifyCriteriaIds: z.array(z.string()).optional(),
    verifyRubricId: z.string().optional(),
  } satisfies Record<keyof TaskVerifyConfig, z.ZodType>)
  .strict();

const TaskDetailSubtaskSchema: z.ZodType<TaskDetailSubtask> = z
  .object({
    archivedAt: dateTimeSchema.nullable().optional(),
    assignee: z
      .object({
        avatar: z.string().nullable(),
        backgroundColor: z.string().nullable(),
        id: z.string(),
        title: z.string().nullable(),
      })
      .strict()
      .nullable()
      .optional(),
    assigneeUserId: z.string().nullable().optional(),
    automationMode: TaskAutomationModeSchema.nullable().optional(),
    blockedBy: z.string().optional(),
    blockedById: z.string().optional(),
    get children() {
      return z.array(TaskDetailSubtaskSchema).optional();
    },
    createdByUserId: z.string().optional(),
    heartbeat: z.object({ interval: z.number().int().nullable().optional() }).strict().optional(),
    id: z.string().optional(),
    identifier: z.string(),
    name: z.string().nullable().optional(),
    priority: z.number().int().nullable().optional(),
    runningTopic: z
      .object({ id: z.string(), operationId: z.string().nullable().optional() })
      .strict()
      .nullable()
      .optional(),
    schedule: z
      .object({
        pattern: z.string().nullable().optional(),
        timezone: z.string().nullable().optional(),
      })
      .strict()
      .optional(),
    status: z.string(),
    updatedAt: dateTimeSchema.optional(),
    visibility: TaskVisibilitySchema.optional(),
  } satisfies Record<keyof TaskDetailSubtask, z.ZodType>)
  .strict()
  .meta({ id: 'TaskDetailSubtask' });

const TaskDetailWorkspaceNodeSchema: z.ZodType<TaskDetailWorkspaceNode> = z
  .object({
    get children() {
      return z.array(TaskDetailWorkspaceNodeSchema).optional();
    },
    createdAt: dateTimeSchema.optional(),
    documentId: z.string(),
    fileType: z.string().optional(),
    /** The viewer lost access to the pinned document; render a placeholder. */
    inaccessible: z.boolean().optional(),
    size: z.number().nullable().optional(),
    sourceTaskId: z.string().optional(),
    sourceTaskIdentifier: z.string().nullable().optional(),
    title: z.string().optional(),
  } satisfies Record<keyof TaskDetailWorkspaceNode, z.ZodType>)
  .strict()
  .meta({ id: 'TaskDetailWorkspaceNode' });

const TaskDetailActivityAuthorSchema = z
  .object({
    avatar: z.string().nullable().optional(),
    id: z.string(),
    name: z.string().nullable().optional(),
    type: z.enum(['agent', 'user']),
    /** The id is recorded but no live row backs it any more. */
    unresolved: z.boolean().optional(),
  } satisfies Record<keyof TaskDetailActivityAuthor, z.ZodType>)
  .strict();

const TaskAutomationSnapshotSchema = z
  .object({
    heartbeatInterval: z.number().int().nullable(),
    maxExecutions: z.number().int().nullable(),
    mode: TaskAutomationModeSchema.nullable(),
    schedulePattern: z.string().nullable(),
    scheduleTimezone: z.string().nullable(),
  })
  .strict();

const TaskDetailActivitySchema = z
  .object({
    /** Brief-only: the actions a brief offers, as the brief stored them. */
    actions: z.unknown().optional(),
    agent: z
      .object({
        avatar: z.string().nullable(),
        backgroundColor: z.string().nullable(),
        id: z.string(),
        name: z.string().nullable().optional(),
        title: z.string().nullable(),
      } satisfies Record<keyof TaskDetailActivityAgent, z.ZodType>)
      .strict()
      .nullable()
      .optional(),
    agentId: z.string().nullable().optional(),
    artifacts: z
      .object({
        documents: z
          .array(
            z
              .object({ id: z.string(), kind: z.string().nullable(), title: z.string().nullable() })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .nullable()
      .optional(),
    assignment: z
      .object({
        from: TaskDetailActivityAuthorSchema.nullable().optional(),
        kind: z.enum(['agent', 'member']),
        to: TaskDetailActivityAuthorSchema.nullable().optional(),
      })
      .strict()
      .optional(),
    author: TaskDetailActivityAuthorSchema.optional(),
    briefType: z.string().optional(),
    completedAt: dateTimeSchema.optional(),
    content: z.string().optional(),
    cost: z.number().nullable().optional(),
    createdAt: dateTimeSchema.optional(),
    cronJobId: z.string().nullable().optional(),
    /** Comment-only: rich Lexical JSON state. */
    editorData: z.unknown().optional(),
    files: z.array(ChatFileItemSchema).optional(),
    id: z.string().optional(),
    operationId: z.string().nullable().optional(),
    priority: z.string().nullable().optional(),
    propertyChange: z
      .union([
        z
          .object({
            field: z.literal('automation'),
            from: TaskAutomationSnapshotSchema.nullable(),
            to: TaskAutomationSnapshotSchema.nullable(),
          })
          .strict(),
        z
          .object({
            field: z.literal('priority'),
            from: z.number().int().nullable(),
            to: z.number().int().nullable(),
          })
          .strict(),
        z
          .object({
            field: z.literal('status'),
            from: z.enum(TASK_STATUSES).nullable(),
            to: z.enum(TASK_STATUSES),
          })
          .strict(),
      ])
      .optional(),
    readAt: dateTimeSchema.nullable().optional(),
    resolvedAction: z.string().nullable().optional(),
    resolvedAt: dateTimeSchema.nullable().optional(),
    resolvedComment: z.string().nullable().optional(),
    runningOperation: z
      .object({
        assistantMessageId: z.string(),
        heteroType: z.string().nullable().optional(),
        operationId: z.string(),
        scope: z.string().optional(),
        threadId: z.string().nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    seq: z.number().int().nullable().optional(),
    sourceTaskId: z.string().nullable().optional(),
    sourceTaskIdentifier: z.string().nullable().optional(),
    sourceTaskName: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    summary: z.string().optional(),
    taskId: z.string().nullable().optional(),
    time: dateTimeSchema.optional(),
    title: z.string().optional(),
    topicId: z.string().nullable().optional(),
    trigger: TaskRunTriggerSchema.nullable().optional(),
    type: z.enum(['assignment', 'brief', 'comment', 'created', 'property', 'topic']),
    userId: z.string().nullable().optional(),
    verify: z
      .object({
        acceptanceId: z.string().nullable(),
        passed: z.number().int(),
        roundIndex: z.number().int().nullable(),
        runId: z.string(),
        status: z.string().nullable(),
        total: z.number().int(),
      } satisfies Record<keyof TaskRunVerifySummary, z.ZodType>)
      .strict()
      .nullable()
      .optional(),
  } satisfies Record<keyof TaskDetailActivity, z.ZodType>)
  .meta({ id: 'TaskDetailActivity' });

/**
 * The task as the detail page reads it: the row projected for display plus its
 * activity feed, subtasks, dependencies, pinned documents and verification.
 */
export const TaskDetailSchema = z
  .object({
    activities: z.array(TaskDetailActivitySchema).optional(),
    agentId: z.string().nullable().optional(),
    archivedAt: dateTimeSchema.nullable().optional(),
    automationMode: TaskAutomationModeSchema.nullable().optional(),
    checkpoint: CheckpointConfigSchema.optional(),
    /** Task configuration pockets, stored as JSON. */
    config: jsonObjectSchema.optional(),
    createdAt: dateTimeSchema.optional(),
    createdByUserId: z.string().nullable().optional(),
    dependencies: z
      .array(
        z
          .object({ dependsOn: z.string(), dependsOnId: z.string().optional(), type: z.string() })
          .strict(),
      )
      .optional(),
    description: z.string().nullable().optional(),
    /** Rich-editor JSON state of the instruction. */
    editorData: z.unknown().optional(),
    error: z.string().nullable().optional(),
    files: z.array(ChatFileItemSchema).optional(),
    goal: z.object({ id: z.string(), title: z.string() }).strict().nullable().optional(),
    heartbeat: z
      .object({
        interval: z.number().int().nullable().optional(),
        lastAt: dateTimeSchema.nullable().optional(),
        scheduledAt: dateTimeSchema.nullable().optional(),
        timeout: z.number().int().nullable().optional(),
      })
      .strict()
      .optional(),
    id: z.string().optional(),
    identifier: z.string(),
    instruction: z.string(),
    labels: z.array(TaskLabelRefSchema).optional(),
    name: z.string().nullable().optional(),
    parent: z
      .object({
        agentId: z.string().nullable().optional(),
        id: z.string().optional(),
        identifier: z.string(),
        name: z.string().nullable(),
      })
      .strict()
      .nullable()
      .optional(),
    priority: z.number().int().nullable().optional(),
    projectId: z.string().nullable().optional(),
    schedule: z
      .object({
        maxExecutions: z.number().int().nullable().optional(),
        pattern: z.string().nullable().optional(),
        timezone: z.string().nullable().optional(),
      })
      .strict()
      .optional(),
    startedAt: dateTimeSchema.optional(),
    status: z.string(),
    subtasks: z.array(TaskDetailSubtaskSchema).optional(),
    topicCount: z.number().int().optional(),
    updatedAt: dateTimeSchema.optional(),
    userId: z.string().nullable().optional(),
    verify: TaskVerifyConfigSchema.nullable().optional(),
    visibility: TaskVisibilitySchema.optional(),
    workspace: z.array(TaskDetailWorkspaceNodeSchema).optional(),
    workspaceId: z.string().nullable().optional(),
  } satisfies Record<keyof TaskDetailData, z.ZodType>)
  .meta({ id: 'TaskDetail' });

const TaskBriefSchema = z.object({ id: z.string(), identifier: z.string() }).strict();

/** What a status transition did: the updated task plus the tasks it paused or unlocked. */
export const TaskStatusUpdateResultSchema = z
  .object({
    allSubtasksDone: z.boolean().optional(),
    checkpointTriggered: z.boolean().optional(),
    /** Completion was requested by the task's own run and lands when that run ends. */
    completionDeferred: z.boolean().optional(),
    parentTaskId: z.string().nullable().optional(),
    paused: z.array(z.string()),
    pausedTasks: z.array(TaskBriefSchema).optional(),
    /** The task was running and left unchanged. */
    skippedRunning: z.boolean().optional(),
    task: TaskSchema,
    unlocked: z.array(z.string()),
    unlockedTasks: z.array(TaskBriefSchema).optional(),
  })
  .strict()
  .meta({ id: 'TaskStatusUpdateResult' });

/**
 * The run that was started: the agent operation (connect to its stream with
 * `operationId` / `token`) plus the task it belongs to. A run that fails to
 * start is answered with an error, never with `success: false` here.
 */
export const TaskRunStartedSchema = z
  .object({
    agentId: z.string(),
    assistantMessageId: z.string(),
    autoStarted: z.boolean(),
    createdAt: dateTimeSchema,
    createdThreadId: z.string().optional(),
    error: z.string().optional(),
    errorData: z
      .object({
        code: z.literal('DEVICE_NOT_FOUND'),
        deviceId: z.string(),
        retryable: z.literal(true),
        scope: z.enum(['personal', 'workspace']),
        workspaceId: z.string().optional(),
      })
      .strict()
      .optional(),
    groupMemberContinuation: z.boolean().optional(),
    heteroType: z.string().nullable().optional(),
    memberOperationId: z.string().optional(),
    message: z.string(),
    messageId: z.string().optional(),
    operationId: z.string(),
    status: z.string(),
    success: z.boolean(),
    supervisorOperationId: z.string().optional(),
    taskId: z.string(),
    taskIdentifier: z.string(),
    terminalReported: z.boolean().optional(),
    timestamp: dateTimeSchema,
    token: z.string().optional(),
    topicId: z.string(),
    userMessageId: z.string(),
  } satisfies Record<keyof ExecAgentResult | 'taskId' | 'taskIdentifier', z.ZodType>)
  .strict()
  .meta({ id: 'TaskRunStarted' });

/** One past run of a task with the handoff its lifecycle wrote. */
export const TaskRunSchema = z
  .object({
    /** The agent that actually ran this topic. */
    agentId: z.string().nullable(),
    completedAt: dateTimeSchema.nullable(),
    /** Raw output of the run, captured on completion. */
    content: z.string().nullable(),
    createdAt: dateTimeSchema,
    keyFindings: z.array(z.string()),
    nextAction: z.string().nullable(),
    /** Whether the lifecycle judged this run worth surfacing; null when it never judged. */
    notable: z.boolean().nullable(),
    seq: z.number().int(),
    status: z.string(),
    summary: z.string().nullable(),
    title: z.string().nullable(),
    topicId: z.string().nullable(),
    trigger: TaskRunTriggerSchema.nullable(),
  })
  .strict()
  .meta({ id: 'TaskRun' });
