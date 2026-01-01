import { trace } from '@opentelemetry/api';

export const tracer = trace.getTracer('@lobechat/upstash-workflow', '0.0.1');

export const ATTR_UPSTASH_WORKFLOW_RUN_ID = 'upstash.workflow.run_id' as const;
export const ATTR_UPSTASH_WORKFLOW_URL = 'upstash.workflow.url' as const;
export const ATTR_UPSTASH_WORKFLOW_FAILURE_URL = 'upstash.workflow.failure_url' as const;
export const ATTR_UPSTASH_WORKFLOW_LABEL = 'upstash.workflow.label' as const;
export const ATTR_UPSTASH_WORKFLOW_RETRY_COUNT = 'upstash.workflow.retries' as const;
export const ATTR_UPSTASH_WORKFLOW_RETRY_DELAY = 'upstash.workflow.retry_delay' as const;

export interface UpstashWorkflowContextAttributes {
  failureUrl?: string;
  label?: string;
  retries?: number;
  retryDelay?: string;
  url?: string;
  workflowRunId?: string;
}

export const buildUpstashWorkflowAttributes = (
  context: UpstashWorkflowContextAttributes,
): Record<string, number | string | undefined> => ({
  [ATTR_UPSTASH_WORKFLOW_FAILURE_URL]: context.failureUrl,
  [ATTR_UPSTASH_WORKFLOW_LABEL]: context.label,
  [ATTR_UPSTASH_WORKFLOW_RETRY_COUNT]: context.retries,
  [ATTR_UPSTASH_WORKFLOW_RETRY_DELAY]: context.retryDelay,
  [ATTR_UPSTASH_WORKFLOW_RUN_ID]: context.workflowRunId,
  [ATTR_UPSTASH_WORKFLOW_URL]: context.url,
});
