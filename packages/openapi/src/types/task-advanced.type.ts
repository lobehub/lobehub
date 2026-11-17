import { z } from 'zod';

import type { TaskCommentItem, TaskDependencyItem, TaskDocumentItem } from '@/database/schemas';

import { dateTimeSchema, jsonObjectSchema } from './common.type';
import {
  CheckpointConfigSchema,
  CreateTaskRequestSchema,
  TaskReviewConfigSchema,
  TaskVerifyConfigSchema,
} from './task.type';

/**
 * Schemas for the task sub-resources: the subtask tree, dependencies, comments,
 * pinned documents, the checkpoint / review / verify configuration and archive.
 * Each mirrors the in-app task surface (tRPC `task.*`), which the REST service
 * calls, so the request shapes accept exactly what the editor accepts.
 */

// ==================== Path / Query Schemas ====================

export const TaskCommentParamSchema = z.object({
  commentId: z.string().min(1),
  id: z.string().min(1),
});
export type TaskCommentParam = z.infer<typeof TaskCommentParamSchema>;

export const TaskDependencyParamSchema = z.object({
  dependsOnId: z.string().min(1).describe('Id or identifier (`T-12`) of the upstream task.'),
  id: z.string().min(1),
});
export type TaskDependencyParam = z.infer<typeof TaskDependencyParamSchema>;

export const TaskDocumentParamSchema = z.object({
  documentId: z.string().min(1),
  id: z.string().min(1),
});
export type TaskDocumentParam = z.infer<typeof TaskDocumentParamSchema>;

export const TaskSubtaskListQuerySchema = z.object({
  recursive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true')
    .describe(
      'Return every descendant instead of only direct children. Each row carries `parentTaskId`, so the tree can be rebuilt.',
    ),
});
export type TaskSubtaskListQuery = z.infer<typeof TaskSubtaskListQuerySchema>;

// ==================== Request Schemas ====================

/** A subtask is created exactly like a task; its parent comes from the path. */
export const CreateSubtaskRequestSchema = CreateTaskRequestSchema.omit({ parentTaskId: true });
export type CreateSubtaskRequest = z.infer<typeof CreateSubtaskRequestSchema>;

export const ReorderSubtasksRequestSchema = z
  .object({
    /** Every direct subtask to order, by id or identifier, first to last. */
    order: z.array(z.string().min(1)).min(1).max(500),
  })
  .strict();
export type ReorderSubtasksRequest = z.infer<typeof ReorderSubtasksRequestSchema>;

const TaskDependencyTypeSchema = z
  .enum(['blocks', 'relates'])
  .describe('`blocks` holds the task in backlog until the upstream task completes.');

export const AddTaskDependencyRequestSchema = z
  .object({
    /** Id or identifier (`T-12`) of the upstream task, in the same project. */
    dependsOnId: z.string().min(1),
    type: TaskDependencyTypeSchema.default('blocks'),
  })
  .strict();
export type AddTaskDependencyRequest = z.infer<typeof AddTaskDependencyRequestSchema>;

export const AddTaskCommentRequestSchema = z
  .object({
    /** Post as one of your agents instead of yourself. */
    authorAgentId: z.string().min(1).optional(),
    briefId: z.string().min(1).optional(),
    /** Markdown body; mention a workspace member with `<mention id="user_…" />`. */
    content: z.string().min(1),
    /** Rich-editor JSON state; derived from `content` when omitted. */
    editorData: jsonObjectSchema.optional(),
    /** The run (topic) the comment is about. */
    topicId: z.string().min(1).optional(),
  })
  .strict();
export type AddTaskCommentRequest = z.infer<typeof AddTaskCommentRequestSchema>;

export const UpdateTaskCommentRequestSchema = z
  .object({
    content: z.string().min(1),
    /** Rich-editor JSON state; omitted clears the stored state so `content` is authoritative. */
    editorData: jsonObjectSchema.optional(),
  })
  .strict();
export type UpdateTaskCommentRequest = z.infer<typeof UpdateTaskCommentRequestSchema>;

export const PinTaskDocumentRequestSchema = z.object({ documentId: z.string().min(1) }).strict();
export type PinTaskDocumentRequest = z.infer<typeof PinTaskDocumentRequestSchema>;

/** Replaces the checkpoint configuration: where the task pauses for a person. */
export const UpdateTaskCheckpointRequestSchema = z
  .object({
    /** Let the running agent ask to pause. */
    onAgentRequest: z.boolean().optional(),
    tasks: z
      .object({
        /** Subtasks (id or identifier) after which this task pauses. */
        afterIds: z.array(z.string().min(1)).optional(),
        /** Subtasks (id or identifier) before which this task pauses. */
        beforeIds: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    topic: z
      .object({
        /** Pause after each run. */
        after: z.boolean().optional(),
        /** Pause before each run. */
        before: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type UpdateTaskCheckpointRequest = z.infer<typeof UpdateTaskCheckpointRequestSchema>;

const TaskReviewRubricSchema = z
  .object({
    /** Rubric-type specific settings. */
    config: jsonObjectSchema,
    extractor: jsonObjectSchema.optional(),
    id: z.string().min(1),
    name: z.string().min(1),
    /** Pass mark from 0 to 1. */
    threshold: z.number().min(0).max(1).optional(),
    type: z.string().min(1),
    weight: z.number().default(1),
  })
  .strict();

/** Replaces the review configuration: the judge that scores each run. */
export const UpdateTaskReviewRequestSchema = z
  .object({
    /** Re-run automatically when a review fails. */
    autoRetry: z.boolean().default(true),
    enabled: z.boolean(),
    judge: z
      .object({ model: z.string().min(1).optional(), provider: z.string().min(1).optional() })
      .strict()
      .default({}),
    maxIterations: z.number().int().min(1).max(10).default(3),
    rubrics: z.array(TaskReviewRubricSchema),
  })
  .strict();
export type UpdateTaskReviewRequest = z.infer<typeof UpdateTaskReviewRequestSchema>;

/** Patches the verify configuration; `null` clears a field, omission keeps it. */
export const UpdateTaskVerifyRequestSchema = z
  .object({
    enabled: z.boolean().nullish(),
    maxIterations: z.number().int().min(1).max(10).nullish(),
    /** The acceptance requirement the verifier checks the delivery against. */
    requirement: z.string().nullish(),
    verifierAgentId: z.string().min(1).nullish(),
    verifyCriteriaIds: z.array(z.string().min(1)).nullish(),
    verifyRubricId: z.string().min(1).nullish(),
  })
  .strict();
export type UpdateTaskVerifyRequest = z.infer<typeof UpdateTaskVerifyRequestSchema>;

// ==================== Response Schemas ====================

export const SubtaskOrderSchema = z
  .object({ id: z.string(), identifier: z.string(), sortOrder: z.number().int() })
  .strict()
  .meta({ id: 'SubtaskOrder' });

export const TaskDependencySchema = z
  .object({
    condition: z.unknown().describe('Reserved for conditional dependencies.'),
    createdAt: dateTimeSchema,
    /** The upstream task id. */
    dependsOnId: z.string(),
    /** The upstream task's display identifier; null when it is not visible to the caller. */
    dependsOnIdentifier: z.string().nullable(),
    id: z.string(),
    taskId: z.string(),
    type: TaskDependencyTypeSchema,
    userId: z.string(),
    visibility: z.enum(['private', 'public']),
    workspaceId: z.string().nullable(),
  } satisfies Record<keyof TaskDependencyItem | 'dependsOnIdentifier', z.ZodType>)
  .strict()
  .meta({ id: 'TaskDependency' });

export const TaskCommentSchema = z
  .object({
    accessedAt: dateTimeSchema,
    /** Set when one of the member's agents wrote the comment. */
    authorAgentId: z.string().nullable(),
    /** Set when the member wrote the comment themselves. */
    authorUserId: z.string().nullable(),
    briefId: z.string().nullable(),
    content: z.string(),
    createdAt: dateTimeSchema,
    /** Rich-editor JSON state. */
    editorData: z.unknown(),
    id: z.string(),
    taskId: z.string(),
    topicId: z.string().nullable(),
    updatedAt: dateTimeSchema,
    /** The member the comment belongs to (the agent's owner for agent comments). */
    userId: z.string(),
    visibility: z.enum(['private', 'public']),
    workspaceId: z.string().nullable(),
  } satisfies Record<keyof TaskCommentItem, z.ZodType>)
  .strict()
  .meta({ id: 'TaskComment' });

export const TaskPinnedDocumentSchema = z
  .object({
    createdAt: dateTimeSchema,
    documentId: z.string(),
    id: z.string(),
    /** `user`, `agent` or `system`. */
    pinnedBy: z.string(),
    taskId: z.string(),
    userId: z.string(),
    visibility: z.enum(['private', 'public']),
    workspaceId: z.string().nullable(),
  } satisfies Record<keyof TaskDocumentItem, z.ZodType>)
  .strict()
  .meta({ id: 'TaskPinnedDocument' });

const CheckpointDisplayRefSchema = z
  .object({
    /** Absent when the referenced subtask is no longer visible. */
    id: z.string().optional(),
    identifier: z.string(),
  })
  .strict();

/** The checkpoint configuration with each referenced subtask resolved for display. */
export const TaskCheckpointSchema = CheckpointConfigSchema.extend({
  afterTasks: z.array(CheckpointDisplayRefSchema).optional(),
  beforeTasks: z.array(CheckpointDisplayRefSchema).optional(),
})
  .strict()
  .meta({ id: 'TaskCheckpoint' });

export const TaskCheckpointConfigSchema = CheckpointConfigSchema.meta({
  id: 'TaskCheckpointConfig',
});

export const TaskVerifySchema = TaskVerifyConfigSchema.meta({ id: 'TaskVerifyConfig' });

export { TaskReviewConfigSchema };

// ==================== Inferred Types ====================

export type SubtaskOrder = z.infer<typeof SubtaskOrderSchema>;
export type TaskCheckpoint = z.infer<typeof TaskCheckpointSchema>;
export type TaskCheckpointConfig = z.infer<typeof TaskCheckpointConfigSchema>;
export type TaskComment = z.infer<typeof TaskCommentSchema>;
export type TaskDependency = z.infer<typeof TaskDependencySchema>;
export type TaskPinnedDocument = z.infer<typeof TaskPinnedDocumentSchema>;
export type TaskReviewConfig = z.infer<typeof TaskReviewConfigSchema>;
export type TaskVerify = z.infer<typeof TaskVerifySchema>;
