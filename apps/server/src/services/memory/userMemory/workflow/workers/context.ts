import type { WorkflowContext } from '@upstash/workflow';
import type { Job } from 'bullmq';

/**
 * Creates a fake WorkflowContext that delegates step execution to direct
 * function calls instead of QStash HTTP callbacks.
 *
 * This is the same pattern used by `agent-signal/impls/local.ts`:
 * `context.run(stepId, handler)` becomes `await handler()` with no
 * persistence or replay. The BullMQ job provides the durability boundary.
 *
 * Use when:
 * - A BullMQ worker processor needs to call an existing workflow handler
 * - The handler expects a `WorkflowContext` with `run()` and `requestPayload`
 *
 * Expects:
 * - `job.data` is JSON-serializable (BullMQ handles this automatically)
 * - The handler does not rely on QStash-specific step replay behavior
 *
 * Returns:
 * - An object matching the `WorkflowContext` shape sufficient for the
 *   memory workflow handlers. Not a full WorkflowContext — methods like
 *   `sleep()` and `call()` are omitted since the handlers don't use them.
 */
export const createLocalWorkflowContext = <TPayload>(
  job: Job<TPayload>,
): WorkflowContext<TPayload> => {
  return {
    requestPayload: job.data,
    workflowRunId: `bullmq-${job.id}`,
    run: async <TResult>(_stepId: string, handler: () => TResult | Promise<TResult>) => handler(),
  } as unknown as WorkflowContext<TPayload>;
};

/**
 * Creates a minimal WorkflowContext for direct in-process execution
 * (no BullMQ job, no QStash — pure local mode).
 *
 * Use when:
 * - MEMORY_WORKFLOW_MODE=local and we want to run handlers synchronously
 * - Testing workflow handlers without any queue infrastructure
 */
export const createDirectWorkflowContext = <TPayload>(
  payload: TPayload,
  workflowRunId?: string,
): WorkflowContext<TPayload> => {
  return {
    requestPayload: payload,
    workflowRunId: workflowRunId ?? `local-${Date.now()}`,
    run: async <TResult>(_stepId: string, handler: () => TResult | Promise<TResult>) => handler(),
  } as unknown as WorkflowContext<TPayload>;
};
