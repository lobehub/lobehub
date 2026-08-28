import { context as otContext } from '@lobechat/observability-otel/api';
import {
  observeOnboardingUnderstandingOperation,
  type OnboardingUnderstandingOperationAttributes,
} from '@lobechat/observability-otel/modules/onboarding-understanding';

import { extractTraceContext, injectActiveTraceHeaders } from '@/libs/observability/traceparent';

interface WorkflowTraceContext {
  headers?: Headers;
}

/**
 * Restores QStash trace context and observes one Understanding workflow delivery.
 *
 * Use when:
 * - Entering an onboarding Understanding Hono workflow handler
 *
 * Expects:
 * - QStash request headers are available when the delivery carries `traceparent`
 *
 * Returns:
 * - The workflow callback result under the restored distributed trace
 */
export const observeOnboardingUnderstandingWorkflow = async <Result>(
  context: WorkflowTraceContext,
  attributes: OnboardingUnderstandingOperationAttributes,
  operation: () => Promise<Result>,
): Promise<Result> => {
  // NOTICE:
  // Hono workflow routes bypass the backend middleware that normally extracts traceparent.
  // QStash forwards trigger headers, but the workflow handler must restore them before spans open.
  // Source/context: `apps/server/src/workflows/agentSignal/run.ts` uses the same extraction boundary.
  // Removal condition: a shared Hono workflow middleware guarantees trace-context extraction.
  const traceContext = context.headers ? extractTraceContext(context.headers) : otContext.active();
  return otContext.with(traceContext, () =>
    observeOnboardingUnderstandingOperation(attributes, operation),
  );
};

/**
 * Serializes the active trace context for an invoked child workflow.
 *
 * Use when:
 * - Calling `WorkflowContext.invoke` from an active Understanding workflow span
 *
 * Expects:
 * - An active span exists when distributed trace continuity is required
 *
 * Returns:
 * - Headers suitable for the Upstash Workflow invoke options
 */
export const getOnboardingUnderstandingTraceHeaders = (): Record<string, string> => {
  const headers = new Headers();
  injectActiveTraceHeaders(headers);
  return Object.fromEntries(headers.entries());
};
