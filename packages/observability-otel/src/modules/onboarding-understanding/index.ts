import type { Attributes } from '@opentelemetry/api';
import { metrics, SpanStatusCode, trace } from '@opentelemetry/api';

const meter = metrics.getMeter('server-services-onboarding-understanding');

/** Shared tracer for the complete onboarding Understanding pipeline. */
export const tracer = trace.getTracer('@lobechat/onboarding-understanding', '0.0.1');

/** Semantic operation attribute shared by spans and metrics. */
export const ATTR_ONBOARDING_UNDERSTANDING_OPERATION =
  'onboarding.understanding.operation' as const;
/** Provider identifier attached to provider-scoped work. */
export const ATTR_ONBOARDING_UNDERSTANDING_PROVIDER = 'onboarding.understanding.provider' as const;
/** Durable session identifier used only for trace correlation. */
export const ATTR_ONBOARDING_UNDERSTANDING_SESSION_ID =
  'onboarding.understanding.session.id' as const;
/** Technical success or error outcome. */
export const ATTR_ONBOARDING_UNDERSTANDING_STATUS = 'onboarding.understanding.status' as const;
/** Topic identifier used only for trace correlation. */
export const ATTR_ONBOARDING_UNDERSTANDING_TOPIC_ID = 'onboarding.understanding.topic.id' as const;

/** Stable operation names used by onboarding Understanding metrics and spans. */
export type OnboardingUnderstandingOperation =
  | 'detailed.commit'
  | 'detailed.generate'
  | 'detailed.process'
  | 'detailed.read-baseline'
  | 'detailed.read-result'
  | 'generation.runtime-call'
  | 'initialize'
  | 'progress.publish'
  | 'provider.collect'
  | 'provider.complete'
  | 'provider.mark-running'
  | 'provider.persist-context'
  | 'provider.process'
  | 'provider.resolve-available'
  | 'session.read'
  | 'session.persist'
  | 'session.start'
  | 'topic.assert-active'
  | 'workflow.collected'
  | 'workflow.detailed-persona'
  | 'workflow.providers'
  | 'workflow.trigger'
  | 'writer.create-message'
  | 'writer.commit'
  | 'writer.generate'
  | 'writer.prepare'
  | 'writer.process'
  | 'writer.read-baseline'
  | 'writer.read-contexts'
  | 'writer.read-existing'
  | 'writer.resolve-agent';

/** Outcome attached to aggregate operation metrics. */
export type OnboardingUnderstandingOperationStatus = 'error' | 'success';

/** Context attached to an onboarding Understanding operation. */
export interface OnboardingUnderstandingOperationAttributes {
  /** Stable low-cardinality operation identifier. */
  operation: OnboardingUnderstandingOperation;
  /** Provider identifier for provider-scoped work. */
  providerId?: string;
  /** Durable Understanding session identifier, emitted only on traces. */
  sessionId?: string;
  /** Personal onboarding topic identifier, emitted only on traces. */
  topicId?: string;
}

/** Count of onboarding Understanding operations grouped by operation and outcome. */
export const operationCounter = meter.createCounter('onboarding_understanding_operations_total', {
  description: 'Count of onboarding Understanding operations grouped by operation and outcome.',
  unit: '{operation}',
});

/** Duration of onboarding Understanding operations grouped by operation and outcome. */
export const operationDurationHistogram = meter.createHistogram(
  'onboarding_understanding_operation_duration',
  {
    description:
      'Duration of onboarding Understanding operations grouped by operation and outcome.',
    unit: 'ms',
  },
);

/** End-to-end duration from API start until a detailed persona is published. */
export const endToEndDurationHistogram = meter.createHistogram(
  'onboarding_understanding_end_to_end_duration',
  {
    description:
      'End-to-end duration from onboarding Understanding API start until a detailed persona publication.',
    unit: 'ms',
  },
);

/**
 * Builds low-cardinality attributes for aggregate Understanding metrics.
 *
 * Use when:
 * - Recording operation counters and duration histograms
 * - Keeping topic and session identifiers out of Prometheus label sets
 *
 * Expects:
 * - Operation names come from the bounded operation union
 *
 * Returns:
 * - Metric-safe attributes containing operation, status, and optional provider
 */
export const buildOnboardingUnderstandingMetricAttributes = (
  attributes: OnboardingUnderstandingOperationAttributes,
  status: OnboardingUnderstandingOperationStatus,
): Attributes => {
  const result: Attributes = {
    [ATTR_ONBOARDING_UNDERSTANDING_OPERATION]: attributes.operation,
    [ATTR_ONBOARDING_UNDERSTANDING_STATUS]: status,
  };
  if (attributes.providerId) {
    result[ATTR_ONBOARDING_UNDERSTANDING_PROVIDER] = attributes.providerId;
  }
  return result;
};

/**
 * Builds trace attributes for one Understanding operation.
 *
 * Use when:
 * - Correlating asynchronous workflow deliveries by topic and session
 *
 * Expects:
 * - Identifiers are already validated by the service or workflow payload schema
 *
 * Returns:
 * - Trace attributes with high-cardinality correlation fields
 */
export const buildOnboardingUnderstandingTraceAttributes = (
  attributes: OnboardingUnderstandingOperationAttributes,
): Attributes => {
  const result: Attributes = {
    [ATTR_ONBOARDING_UNDERSTANDING_OPERATION]: attributes.operation,
  };
  if (attributes.providerId) {
    result[ATTR_ONBOARDING_UNDERSTANDING_PROVIDER] = attributes.providerId;
  }
  if (attributes.sessionId) {
    result[ATTR_ONBOARDING_UNDERSTANDING_SESSION_ID] = attributes.sessionId;
  }
  if (attributes.topicId) {
    result[ATTR_ONBOARDING_UNDERSTANDING_TOPIC_ID] = attributes.topicId;
  }
  return result;
};

/**
 * Observes one asynchronous onboarding Understanding operation.
 *
 * Use when:
 * - Timing service, provider, writer, or workflow boundaries
 * - Preserving the active trace context across nested async work
 *
 * Expects:
 * - The callback owns the complete operation being timed
 *
 * Returns:
 * - The callback result while recording success or error telemetry
 */
export const observeOnboardingUnderstandingOperation = async <Result>(
  attributes: OnboardingUnderstandingOperationAttributes,
  operation: () => Promise<Result>,
): Promise<Result> =>
  tracer.startActiveSpan(
    `onboarding_understanding.${attributes.operation}`,
    { attributes: buildOnboardingUnderstandingTraceAttributes(attributes) },
    async (span) => {
      const startedAt = Date.now();
      let status: OnboardingUnderstandingOperationStatus = 'success';

      try {
        const result = await operation();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        status = 'error';
        const errorType = error instanceof Error ? error.name : typeof error;
        span.setAttribute('error.type', errorType);
        span.setStatus({ code: SpanStatusCode.ERROR, message: errorType });
        span.recordException(error instanceof Error ? error : String(error));
        throw error;
      } finally {
        const metricAttributes = buildOnboardingUnderstandingMetricAttributes(attributes, status);
        operationCounter.add(1, metricAttributes);
        operationDurationHistogram.record(Date.now() - startedAt, metricAttributes);
        span.end();
      }
    },
  );

/**
 * Records successful end-to-end onboarding Understanding latency.
 *
 * Use when:
 * - Detailed persona writing has committed for a workflow carrying the API start timestamp
 *
 * Expects:
 * - `startedAt` is an epoch-millisecond timestamp no later than the current time
 *
 * Returns:
 * - Nothing; invalid or future timestamps are ignored
 */
export const recordOnboardingUnderstandingEndToEndDuration = (startedAt?: number): void => {
  if (!startedAt || !Number.isFinite(startedAt)) return;
  const duration = Date.now() - startedAt;
  if (duration < 0) return;
  endToEndDurationHistogram.record(duration, {
    [ATTR_ONBOARDING_UNDERSTANDING_STATUS]: 'success',
  });
};
