import type {
  MemoryExtractionHourlyWorkflowPayload,
  MemoryExtractionPayloadInput,
  UserTopicWorkflowPayload,
} from '../../extract';
import type { MemoryWorkflowTriggerResult, MemoryWorkflowTriggerService } from '../types';
import { DEFAULT_JOB_OPTIONS, getQueues } from '../workers/queues';

/**
 * BullMQ-backed workflow trigger implementation.
 *
 * Enqueues jobs into Redis-backed BullMQ queues instead of calling QStash.
 * Used when MEMORY_WORKFLOW_MODE=local-queue (self-hosted production).
 *
 * Each trigger method maps to one BullMQ queue. Concurrency and rate limiting
 * are configured on the Worker side (see workers/bootstrap.ts), not here.
 * The queue.add() call is fire-and-forget — BullMQ handles delivery guarantees.
 */
export class BullMQWorkflowTrigger implements MemoryWorkflowTriggerService {
  async triggerProcessUsers(
    payload: MemoryExtractionPayloadInput,
  ): Promise<MemoryWorkflowTriggerResult> {
    if (!payload.baseUrl) throw new Error('Missing baseUrl for workflow trigger');

    const queues = getQueues();
    const job = await queues.processUsers.add('process-users', payload, DEFAULT_JOB_OPTIONS);
    return { workflowRunId: `bullmq-${job.id}` };
  }

  async triggerHourly(
    payload: MemoryExtractionHourlyWorkflowPayload,
    options?: { workflowRunId?: string },
  ): Promise<MemoryWorkflowTriggerResult> {
    if (!payload.baseUrl) throw new Error('Missing baseUrl for workflow trigger');

    const queues = getQueues();
    const job = await queues.hourly.add('hourly', payload, {
      ...DEFAULT_JOB_OPTIONS,
      jobId: options?.workflowRunId,
    });
    return { workflowRunId: `bullmq-${job.id}` };
  }

  async triggerProcessUserTopics(
    payload: UserTopicWorkflowPayload,
  ): Promise<MemoryWorkflowTriggerResult> {
    if (!payload.baseUrl) throw new Error('Missing baseUrl for workflow trigger');

    const queues = getQueues();
    const job = await queues.userTopics.add('user-topics', payload, DEFAULT_JOB_OPTIONS);
    return { workflowRunId: `bullmq-${job.id}` };
  }

  async triggerProcessTopics(
    userId: string,
    payload: MemoryExtractionPayloadInput,
  ): Promise<MemoryWorkflowTriggerResult> {
    if (!payload.baseUrl) throw new Error('Missing baseUrl for workflow trigger');

    const queues = getQueues();
    const job = await queues.processTopics.add('process-topics', payload, {
      ...DEFAULT_JOB_OPTIONS,
      jobId: `topics-${userId}-${Date.now()}`,
    });
    return { workflowRunId: `bullmq-${job.id}` };
  }

  async triggerProcessTopic(
    userId: string,
    payload: MemoryExtractionPayloadInput,
  ): Promise<MemoryWorkflowTriggerResult> {
    if (!payload.baseUrl) throw new Error('Missing baseUrl for workflow trigger');

    const queues = getQueues();
    const job = await queues.processTopic.add('process-topic', payload, {
      ...DEFAULT_JOB_OPTIONS,
      jobId: `topic-${userId}-${payload.topicIds?.[0] ?? Date.now()}`,
    });
    return { workflowRunId: `bullmq-${job.id}` };
  }

  async triggerPersonaUpdate(
    userId: string,
    baseUrl: string,
    options?: { hourlyTaskId?: string },
  ): Promise<MemoryWorkflowTriggerResult> {
    if (!baseUrl) throw new Error('Missing baseUrl for workflow trigger');

    const queues = getQueues();
    const job = await queues.personaUpdate.add(
      'persona-update',
      { hourlyTaskId: options?.hourlyTaskId, userIds: [userId] },
      { ...DEFAULT_JOB_OPTIONS, jobId: `persona-${userId}-${Date.now()}` },
    );
    return { workflowRunId: `bullmq-${job.id}` };
  }
}
