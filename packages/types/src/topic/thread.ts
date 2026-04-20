import { z } from 'zod';

export const ThreadType = {
  Continuation: 'continuation',
  Eval: 'eval',
  Isolation: 'isolation',
  Standalone: 'standalone',
} as const;

export type IThreadType = (typeof ThreadType)[keyof typeof ThreadType];

/**
 * Thread types available for chat (excludes eval-only types)
 */
export type ChatThreadType = Exclude<IThreadType, 'eval'>;

export enum ThreadStatus {
  Active = 'active',
  Cancel = 'cancel',
  Completed = 'completed',
  Failed = 'failed',
  InReview = 'inReview',
  Pending = 'pending',
  Processing = 'processing',
  Todo = 'todo',
}

/**
 * Metadata for Thread, used for agent task execution
 */
export interface ThreadMetadata {
  [key: string]: unknown;
  /** Whether this thread runs in client mode (local execution) */
  clientMode?: boolean;
  /** Task completion time */
  completedAt?: string;
  /** Execution duration in milliseconds */
  duration?: number;
  /** Error details when task failed */
  error?: any;
  /** Operation ID for tracking */
  operationId?: string;
  /**
   * The specific tool_use id within `sourceMessageId` that spawned this thread.
   * Used to position the thread inline as a `task` block within the parent
   * message's content stream — e.g. CC's `Task` tool_use spawning a subagent.
   * Multiple threads can share the same `sourceMessageId` (parallel subagents),
   * disambiguated by this field.
   */
  sourceToolCallId?: string;
  /** Task start time, used to calculate duration */
  startedAt?: string;
  /** Subagent type identifier, e.g. CC's `subagent_type` input (Explore, Plan, ...) */
  subagentType?: string;
  /** Total cost in dollars */
  totalCost?: number;
  /** Total messages created during execution */
  totalMessages?: number;
  /** Total tokens consumed */
  totalTokens?: number;
  /** Total tool calls made */
  totalToolCalls?: number;
}

export interface ThreadItem {
  /** Agent ID for agent task execution */
  agentId?: string | null;
  createdAt: Date;
  /** Group ID for group chat context */
  groupId?: string | null;
  id: string;
  lastActiveAt: Date;
  /** Metadata for agent task execution */
  metadata?: ThreadMetadata;
  parentThreadId?: string;
  sourceMessageId?: string | null;
  status: ThreadStatus;
  title: string;
  topicId: string;
  type: IThreadType;
  updatedAt: Date;
  userId: string;
}

export interface CreateThreadParams {
  /** Agent ID for agent task execution */
  agentId?: string;
  /** Group ID for group chat context */
  groupId?: string;
  /**
   * Optional client-provided id. Lets the caller derive the thread id
   * synchronously (e.g. when wiring CC subagent threads from the stream
   * adapter, where the id needs to be known before the create call returns
   * so subagent inner messages can be persisted with the right `threadId`).
   * Falls back to the schema's `idGenerator` when omitted.
   */
  id?: string;
  /** Initial metadata for the thread */
  metadata?: ThreadMetadata;
  parentThreadId?: string;
  sourceMessageId?: string;
  /** Initial status (defaults to Active) */
  status?: ThreadStatus;
  title?: string;
  topicId: string;
  type: IThreadType;
}

export const threadMetadataSchema = z.object({
  clientMode: z.boolean().optional(),
  completedAt: z.string().optional(),
  duration: z.number().optional(),
  error: z.any().optional(),
  operationId: z.string().optional(),
  sourceToolCallId: z.string().optional(),
  startedAt: z.string().optional(),
  subagentType: z.string().optional(),
  totalCost: z.number().optional(),
  totalMessages: z.number().optional(),
  totalTokens: z.number().optional(),
  totalToolCalls: z.number().optional(),
});

export const createThreadSchema = z.object({
  agentId: z.string().optional(),
  groupId: z.string().optional(),
  id: z.string().optional(),
  metadata: threadMetadataSchema.optional(),
  parentThreadId: z.string().optional(),
  sourceMessageId: z.string().optional(),
  title: z.string().optional(),
  topicId: z.string(),
  type: z.enum([
    ThreadType.Continuation,
    ThreadType.Eval,
    ThreadType.Standalone,
    ThreadType.Isolation,
  ]),
});
