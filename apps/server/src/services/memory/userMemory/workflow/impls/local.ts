import type {
  MemoryExtractionHourlyWorkflowPayload,
  MemoryExtractionPayloadInput,
  UserTopicWorkflowPayload,
} from '../../extract';
import type { MemoryWorkflowTriggerResult, MemoryWorkflowTriggerService } from '../types';
import { createDirectWorkflowContext } from '../workers/context';

/**
 * Local in-process workflow trigger implementation.
 *
 * Calls workflow handlers directly without any queue infrastructure.
 * Used for development and testing when no Redis or QStash is available.
 *
 * This follows the same pattern as `agent-signal/impls/local.ts`:
 * - Defers execution via setTimeout so the caller can return first
 * - Uses a fake WorkflowContext where context.run() is a passthrough
 * - No durability — a crash loses all in-flight work
 */
export class LocalWorkflowTrigger implements MemoryWorkflowTriggerService {
  async triggerProcessUsers(
    payload: MemoryExtractionPayloadInput,
  ): Promise<MemoryWorkflowTriggerResult> {
    const workflowRunId = `local-process-users-${Date.now()}`;

    setTimeout(async () => {
      try {
        const { processUsersHandler } =
          await import('@/server/router-hono/workflows/memory-user-memory/workflows/processUsers');
        const context = createDirectWorkflowContext(payload, workflowRunId);
        await processUsersHandler(context as any);
      } catch (error) {
        console.error('[memory-local] processUsers failed:', error);
      }
    }, 0);

    return { workflowRunId };
  }

  async triggerHourly(
    payload: MemoryExtractionHourlyWorkflowPayload,
  ): Promise<MemoryWorkflowTriggerResult> {
    const workflowRunId = `local-hourly-${Date.now()}`;

    setTimeout(async () => {
      try {
        const { hourlyWorkflowHandler } =
          await import('@/server/router-hono/workflows/memory-user-memory/workflows/hourly');
        const context = createDirectWorkflowContext(payload, workflowRunId);
        await hourlyWorkflowHandler(context as any);
      } catch (error) {
        console.error('[memory-local] hourly failed:', error);
      }
    }, 0);

    return { workflowRunId };
  }

  async triggerProcessUserTopics(
    payload: UserTopicWorkflowPayload,
  ): Promise<MemoryWorkflowTriggerResult> {
    const workflowRunId = `local-user-topics-${Date.now()}`;

    setTimeout(async () => {
      try {
        const { processUserTopicsHandler } =
          await import('@/server/router-hono/workflows/memory-user-memory/workflows/processUserTopics');
        const context = createDirectWorkflowContext(payload, workflowRunId);
        await processUserTopicsHandler(context as any);
      } catch (error) {
        console.error('[memory-local] processUserTopics failed:', error);
      }
    }, 0);

    return { workflowRunId };
  }

  async triggerProcessTopics(
    _userId: string,
    payload: MemoryExtractionPayloadInput,
  ): Promise<MemoryWorkflowTriggerResult> {
    const workflowRunId = `local-topics-${Date.now()}`;

    setTimeout(async () => {
      try {
        const { processTopicsHandler } =
          await import('@/server/router-hono/workflows/memory-user-memory/workflows/processTopics');
        const context = createDirectWorkflowContext(payload, workflowRunId);
        await processTopicsHandler(context as any);
      } catch (error) {
        console.error('[memory-local] processTopics failed:', error);
      }
    }, 0);

    return { workflowRunId };
  }

  async triggerProcessTopic(
    _userId: string,
    payload: MemoryExtractionPayloadInput,
  ): Promise<MemoryWorkflowTriggerResult> {
    const workflowRunId = `local-topic-${Date.now()}`;

    setTimeout(async () => {
      try {
        const { processTopicHandler } =
          await import('@/server/router-hono/workflows/memory-user-memory/workflows/processTopic');
        const context = createDirectWorkflowContext(payload, workflowRunId);
        await processTopicHandler(context as any);
      } catch (error) {
        console.error('[memory-local] processTopic failed:', error);
      }
    }, 0);

    return { workflowRunId };
  }

  async triggerPersonaUpdate(
    userId: string,
    _baseUrl: string,
    options?: { hourlyTaskId?: string },
  ): Promise<MemoryWorkflowTriggerResult> {
    const workflowRunId = `local-persona-${Date.now()}`;

    setTimeout(async () => {
      try {
        const { personaUpdateHandler } =
          await import('@/server/router-hono/workflows/memory-user-memory/workflows/personaUpdate');
        const context = createDirectWorkflowContext(
          { hourlyTaskId: options?.hourlyTaskId, userIds: [userId] },
          workflowRunId,
        );
        await personaUpdateHandler(context as any);
      } catch (error) {
        console.error('[memory-local] personaUpdate failed:', error);
      }
    }, 0);

    return { workflowRunId };
  }
}
