import { z } from 'zod';

import type { WorkingDirConfig } from '../device';
import { workingDirConfigSchema } from '../device';
import {
  type OnboardingUnderstandingThreadMarker,
  OnboardingUnderstandingThreadMarkerSchema,
} from '../understanding';

export const ThreadType = {
  Continuation: 'continuation',
  Eval: 'eval',
  Isolation: 'isolation',
  Standalone: 'standalone',
} as const;

/** A persisted native boundary; UI pagination must never determine a Codex fork. */
export const CodexForkTargetSchema = z.object({
  position: z.enum(['before', 'after']),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
});
export type CodexForkTarget = z.infer<typeof CodexForkTargetSchema>;

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
  /** Immutable native origin of a Codex Fork branch; the child session is tracked separately. */
  codexForkTarget?: CodexForkTarget;
  /** Task completion time */
  completedAt?: string;
  /** Execution duration in milliseconds */
  duration?: number;
  /** Error details when task failed */
  error?: any;
  heteroSessionBindingKey?: string;
  heteroSessionBindingKeyByWorkingDirectory?: Record<string, string>;
  heteroSessionId?: string;
  heteroSessionIdByWorkingDirectory?: Record<string, string>;
  /**
   * Model the subagent ran on (e.g. CC's per-turn `message.model`). Pinned
   * once for the run and rolled up here on finalize so historical / cold-load
   * viewers can surface it (e.g. the subagent inspector chip tooltip) without
   * the child messages being loaded.
   */
  model?: string;
  /** Marks hidden onboarding Understanding writing isolation threads. */
  onboardingUnderstanding?: OnboardingUnderstandingThreadMarker;
  /** Operation ID for tracking */
  operationId?: string;
  /** A user-message fork replays its source prompt instead of inheriting its old answer. */
  sourceMessageExcluded?: boolean;
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
  workingDirectory?: string;
  workingDirectoryConfig?: WorkingDirConfig;
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
  codexForkTarget: CodexForkTargetSchema.optional(),
  completedAt: z.string().optional(),
  duration: z.number().optional(),
  error: z.any().optional(),
  heteroSessionBindingKey: z.string().optional(),
  heteroSessionBindingKeyByWorkingDirectory: z.record(z.string(), z.string()).optional(),
  heteroSessionId: z.string().optional(),
  heteroSessionIdByWorkingDirectory: z.record(z.string(), z.string()).optional(),
  model: z.string().optional(),
  onboardingUnderstanding: OnboardingUnderstandingThreadMarkerSchema.optional(),
  operationId: z.string().optional(),
  sourceToolCallId: z.string().optional(),
  sourceMessageExcluded: z.boolean().optional(),
  startedAt: z.string().optional(),
  subagentType: z.string().optional(),
  totalCost: z.number().optional(),
  totalMessages: z.number().optional(),
  totalTokens: z.number().optional(),
  totalToolCalls: z.number().optional(),
  workingDirectory: z.string().optional(),
  workingDirectoryConfig: workingDirConfigSchema.optional(),
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
