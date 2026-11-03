import { errorNameFrom } from '@lobechat/utils';
import { metrics, trace } from '@opentelemetry/api';

const meter = metrics.getMeter('server-services-upstash-workflow');
export const tracer = trace.getTracer('@lobechat/upstash-workflow', '0.0.1');

export const ATTR_UPSTASH_WORKFLOW_OPERATION = 'upstash_workflow_operation' as const;
export const ATTR_UPSTASH_WORKFLOW_STATUS = 'upstash_workflow_status' as const;
export const ATTR_UPSTASH_WORKFLOW_INTERFACE = 'upstash_workflow_interface' as const;
export const ATTR_UPSTASH_WORKFLOW_URL = 'upstash_workflow_url' as const;
export const ATTR_UPSTASH_WORKFLOW_PATH = 'upstash_workflow_path' as const;
export const ATTR_UPSTASH_WORKFLOW_RETRY_COUNT = 'upstash_workflow_retries' as const;
export const ATTR_UPSTASH_WORKFLOW_RETRY_DELAY = 'upstash_workflow_retry_delay' as const;
export const ATTR_UPSTASH_WORKFLOW_ERROR_TYPE = 'upstash_workflow_error_type' as const;

/**
 * Count Upstash Workflow and QStash lifecycle events.
 *
 * Use when:
 * - Tracking workflow trigger, step, invoke, and serve volumes
 * - Comparing outbound QStash/Workflow calls with inbound workflow deliveries
 *
 * Expects:
 * - Low-cardinality labels such as operation, status, interface, and route path
 *
 * Returns:
 * - Monotonic event counts exported through the configured OTEL metric reader
 */
export const workflowEventCounter = meter.createCounter('upstash_workflow_events_total', {
  description:
    'Count of Upstash Workflow and QStash lifecycle events grouped by operation and status.',
  unit: '{event}',
});

export type UpstashWorkflowOperation = 'invoke' | 'serve' | 'step' | 'trigger';
export type UpstashWorkflowInterface = 'qstash' | 'workflow';
export type UpstashWorkflowStatus = 'abort' | 'error' | 'success';

const UPSTASH_WORKFLOW_ABORT_ERROR_TYPES = new Set(['WorkflowAbort', 'WorkflowRetryAfterError']);

export interface UpstashWorkflowContextAttributes {
  failureUrl?: string;
  label?: string;
  retries?: number;
  retryDelay?: string;
  url?: string;
  workflowRunId?: string;
}

export interface UpstashWorkflowMetricAttributes extends UpstashWorkflowContextAttributes {
  errorType?: string;
  interface?: UpstashWorkflowInterface;
  operation: UpstashWorkflowOperation;
  path?: string;
  status: UpstashWorkflowStatus;
  stepName?: string;
}

export interface UpstashWorkflowContextLike<
  TInitialPayload = unknown,
> extends UpstashWorkflowContextAttributes {
  invoke?: <TResult = unknown>(stepName: string, settings: unknown) => Promise<TResult>;
  requestPayload: TInitialPayload;
  run: <TResult>(
    stepName: string,
    stepFunction: () => TResult | Promise<TResult>,
  ) => Promise<TResult | Promise<TResult>>;
}

/**
 * Normalizes workflow URLs into route paths.
 *
 * Before:
 * - "https://app.example.com/api/workflows/task/watchdog"
 *
 * After:
 * - "/api/workflows/task/watchdog"
 */
export const normalizeUpstashWorkflowPath = (url?: string): string | undefined => {
  if (!url) return undefined;

  try {
    return new URL(url).pathname;
  } catch {
    return url.startsWith('/') ? url : undefined;
  }
};

const statusFromUpstashWorkflowError = (error: unknown): UpstashWorkflowStatus =>
  UPSTASH_WORKFLOW_ABORT_ERROR_TYPES.has(errorNameFrom(error) ?? '') ? 'abort' : 'error';

/**
 * Builds metric attributes for Upstash Workflow and QStash events.
 *
 * Use when:
 * - Recording a workflow lifecycle counter from shared wrappers
 * - Normalizing route URLs into low-cardinality path labels
 *
 * Expects:
 * - `operation` and `status` are present for metric counter events
 * - `url` may be absolute or an already-normalized route path
 * - Per-run identifiers are excluded from metric labels to avoid high-cardinality series
 * - `upstash_workflow_url` stores the normalized route path, not the absolute URL
 *
 * Returns:
 * - Attribute map accepted by OpenTelemetry metrics APIs
 */
export const buildUpstashWorkflowMetricAttributes = (
  attributes: UpstashWorkflowContextAttributes &
    Partial<Omit<UpstashWorkflowMetricAttributes, keyof UpstashWorkflowContextAttributes>>,
): Record<string, boolean | number | string | undefined> => ({
  [ATTR_UPSTASH_WORKFLOW_ERROR_TYPE]: attributes.errorType,
  [ATTR_UPSTASH_WORKFLOW_INTERFACE]: attributes.interface,
  [ATTR_UPSTASH_WORKFLOW_OPERATION]: attributes.operation,
  [ATTR_UPSTASH_WORKFLOW_PATH]: attributes.path ?? normalizeUpstashWorkflowPath(attributes.url),
  [ATTR_UPSTASH_WORKFLOW_RETRY_COUNT]: attributes.retries,
  [ATTR_UPSTASH_WORKFLOW_RETRY_DELAY]: attributes.retryDelay,
  [ATTR_UPSTASH_WORKFLOW_STATUS]: attributes.status,
  [ATTR_UPSTASH_WORKFLOW_URL]: attributes.path ?? normalizeUpstashWorkflowPath(attributes.url),
});

/**
 * Records one or more Upstash Workflow lifecycle events.
 *
 * Use when:
 * - A QStash publish or Workflow trigger is attempted
 * - A workflow route is served by Upstash
 * - A workflow step or invoke call is submitted from a context
 *
 * Expects:
 * - `count` is the number of events represented by this observation
 *
 * Returns:
 * - Nothing; the observation is emitted to the active OTEL meter provider
 */
export const recordUpstashWorkflowEvent = (
  attributes: UpstashWorkflowMetricAttributes,
  count = 1,
): void => {
  workflowEventCounter.add(count, buildUpstashWorkflowMetricAttributes(attributes));
};

/**
 * Wraps a WorkflowContext with step and invoke counters.
 *
 * Use when:
 * - Wrapping an Upstash Workflow route function before passing it to `serve`
 * - Counting `context.run(...)` and `context.invoke(...)` calls without editing each step
 *
 * Expects:
 * - Upstash context methods keep their original `this` binding
 *
 * Returns:
 * - The same context instance with wrapped methods
 */
export const withOtelMetricsForUpstashWorkflowContext = <
  TInitialPayload,
  TContext extends UpstashWorkflowContextLike<TInitialPayload>,
>(
  context: TContext,
  baseAttributes?: Partial<UpstashWorkflowContextAttributes>,
): TContext => {
  const originalRun = context.run;

  context.run = (async <TResult>(
    stepName: string,
    stepFunction: () => TResult | Promise<TResult>,
  ): Promise<TResult | Promise<TResult>> => {
    try {
      const result = await (originalRun.call(context, stepName, stepFunction) as Promise<
        TResult | Promise<TResult>
      >);
      recordUpstashWorkflowEvent({
        ...baseAttributes,
        ...context,
        operation: 'step',
        status: 'success',
        stepName,
      });

      return result;
    } catch (error) {
      recordUpstashWorkflowEvent({
        ...baseAttributes,
        ...context,
        errorType: errorNameFrom(error) ?? typeof error,
        operation: 'step',
        status: statusFromUpstashWorkflowError(error),
        stepName,
      });

      throw error;
    }
  }) as TContext['run'];

  if (context.invoke) {
    const originalInvoke = context.invoke;

    context.invoke = (async <TResult = unknown>(
      stepName: string,
      settings: unknown,
    ): Promise<TResult> => {
      try {
        const result = await (originalInvoke.call(context, stepName, settings) as Promise<TResult>);
        recordUpstashWorkflowEvent({
          ...baseAttributes,
          ...context,
          operation: 'invoke',
          status: 'success',
          stepName,
        });

        return result;
      } catch (error) {
        recordUpstashWorkflowEvent({
          ...baseAttributes,
          ...context,
          errorType: errorNameFrom(error) ?? typeof error,
          operation: 'invoke',
          status: statusFromUpstashWorkflowError(error),
          stepName,
        });

        throw error;
      }
    }) as TContext['invoke'];
  }

  return context;
};

/**
 * Wraps an Upstash Workflow route function with serve, step, and invoke metrics.
 *
 * Use when:
 * - Passing a handler to `@upstash/workflow/hono` or `@upstash/workflow/nextjs` `serve`
 * - Counting inbound workflow deliveries and the steps they submit
 *
 * Expects:
 * - The wrapped function receives a standard WorkflowContext-like object
 *
 * Returns:
 * - A route function with the same result contract as the original handler
 */
export const withOtelMetricsForUpstashWorkflows = <TContext, TResult>(
  routeFunction: (context: TContext) => Promise<TResult>,
  baseAttributes?: Partial<UpstashWorkflowContextAttributes>,
) => {
  return async (context: TContext): Promise<TResult> => {
    const instrumentedContext = withOtelMetricsForUpstashWorkflowContext(
      context as TContext & UpstashWorkflowContextLike,
      baseAttributes,
    ) as TContext;

    try {
      const result = await routeFunction(instrumentedContext);
      recordUpstashWorkflowEvent({
        ...baseAttributes,
        ...(context as UpstashWorkflowContextAttributes),
        operation: 'serve',
        status: 'success',
      });

      return result;
    } catch (error) {
      recordUpstashWorkflowEvent({
        ...baseAttributes,
        ...(context as UpstashWorkflowContextAttributes),
        errorType: errorNameFrom(error) ?? typeof error,
        operation: 'serve',
        status: statusFromUpstashWorkflowError(error),
      });

      throw error;
    }
  };
};
