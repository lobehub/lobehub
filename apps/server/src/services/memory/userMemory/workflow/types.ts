import type {
  MemoryExtractionHourlyWorkflowPayload,
  MemoryExtractionPayloadInput,
} from '@/server/services/memory/userMemory/extract';

/**
 * Execution mode for the memory extraction workflow.
 *
 * - `qstash`: Upstash QStash Workflows (cloud/Vercel deployments)
 * - `bullmq`: BullMQ + Redis (self-hosted production)
 * - `local`: Direct in-process execution (dev/testing)
 */
export type MemoryWorkflowMode = 'qstash' | 'bullmq' | 'local';

/**
 * Result returned by any workflow trigger implementation.
 */
export interface MemoryWorkflowTriggerResult {
  workflowRunId: string;
}

/**
 * Options shared across all trigger implementations.
 */
export interface MemoryWorkflowTriggerOptions {
  entryWorkflowRunId?: string;
  extraHeaders?: Record<string, string>;
  hourlyTaskId?: string;
}

/**
 * Payload for user-topic workflow triggers.
 */
export interface UserTopicWorkflowTriggerPayload extends MemoryExtractionPayloadInput {
  topicCursor?: { createdAt: string; id: string; userId: string };
  userId?: string;
  userIds?: string[];
}

/**
 * Interface that all workflow trigger implementations must satisfy.
 *
 * Each method corresponds to one QStash workflow endpoint. Implementations
 * translate these calls into their transport-specific mechanism (QStash trigger,
 * BullMQ queue.add, or direct in-process execution).
 */
export interface MemoryWorkflowTriggerService {
  triggerHourly: (
    payload: MemoryExtractionHourlyWorkflowPayload,
    options?: MemoryWorkflowTriggerOptions & { workflowRunId?: string },
  ) => Promise<MemoryWorkflowTriggerResult>;

  triggerPersonaUpdate: (
    userId: string,
    baseUrl: string,
    options?: MemoryWorkflowTriggerOptions,
  ) => Promise<MemoryWorkflowTriggerResult>;

  triggerProcessTopic: (
    userId: string,
    payload: MemoryExtractionPayloadInput,
    options?: MemoryWorkflowTriggerOptions,
  ) => Promise<MemoryWorkflowTriggerResult>;

  triggerProcessTopics: (
    userId: string,
    payload: MemoryExtractionPayloadInput,
    options?: MemoryWorkflowTriggerOptions,
  ) => Promise<MemoryWorkflowTriggerResult>;

  triggerProcessUsers: (
    payload: MemoryExtractionPayloadInput,
    options?: MemoryWorkflowTriggerOptions,
  ) => Promise<MemoryWorkflowTriggerResult>;

  triggerProcessUserTopics: (
    payload: UserTopicWorkflowTriggerPayload,
    options?: MemoryWorkflowTriggerOptions,
  ) => Promise<MemoryWorkflowTriggerResult>;
}
