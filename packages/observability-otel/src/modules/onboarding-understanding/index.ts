import type { Attributes, Span } from '@opentelemetry/api';
import { metrics, SpanStatusCode, trace } from '@opentelemetry/api';

const meter = metrics.getMeter('server-services-onboarding-understanding');

/** Shared tracer for the complete onboarding Understanding pipeline. */
export const tracer = trace.getTracer('@lobechat/onboarding-understanding', '0.0.1');

/** Semantic operation attribute shared by spans and metrics. */
export const ATTR_ONBOARDING_UNDERSTANDING_OPERATION =
  'onboarding.understanding.operation' as const;
/** Provider identifier attached to provider-scoped work. */
export const ATTR_ONBOARDING_UNDERSTANDING_PROVIDER = 'onboarding.understanding.provider' as const;
/** Business outcome of one provider collection attempt. */
export const ATTR_ONBOARDING_UNDERSTANDING_PROVIDER_OUTCOME =
  'onboarding.understanding.provider.outcome' as const;
/** Number of evidence items returned by one provider collection attempt. */
export const ATTR_ONBOARDING_UNDERSTANDING_PROVIDER_EVIDENCE_COUNT =
  'onboarding.understanding.provider.evidence_count' as const;
/** Number of failed provider sub-operations in one collection attempt. */
export const ATTR_ONBOARDING_UNDERSTANDING_PROVIDER_FAILED_COUNT =
  'onboarding.understanding.provider.failed_count' as const;
/** Number of source items returned by one provider collection attempt. */
export const ATTR_ONBOARDING_UNDERSTANDING_PROVIDER_SOURCE_COUNT =
  'onboarding.understanding.provider.source_count' as const;
/** Number of successful provider sub-operations in one collection attempt. */
export const ATTR_ONBOARDING_UNDERSTANDING_PROVIDER_SUCCEEDED_COUNT =
  'onboarding.understanding.provider.succeeded_count' as const;
/** Failure code attached to provider collection diagnostics. */
export const ATTR_ONBOARDING_UNDERSTANDING_FAILURE_CODE =
  'onboarding.understanding.failure.code' as const;
/** Original provider error message attached only to trace events. */
export const ATTR_ONBOARDING_UNDERSTANDING_FAILURE_MESSAGE =
  'onboarding.understanding.failure.message' as const;
/** Provider sub-operation attached to collection diagnostics. */
export const ATTR_ONBOARDING_UNDERSTANDING_FAILURE_OPERATION =
  'onboarding.understanding.failure.operation' as const;
/** Whether a provider collection diagnostic is safe to retry. */
export const ATTR_ONBOARDING_UNDERSTANDING_FAILURE_RETRYABLE =
  'onboarding.understanding.failure.retryable' as const;
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
export type OnboardingUnderstandingOperationStatus = 'error' | 'failed' | 'success';

/** Business outcome of one provider collection attempt. */
export type OnboardingUnderstandingProviderCollectionOutcome =
  'completed' | 'error' | 'failed' | 'partial';

/** Provider diagnostic attached to a collection attempt. */
export interface OnboardingUnderstandingProviderCollectionDiagnostic {
  /** Failure code owned by the provider integration. */
  code: string;
  /** Original error message retained for persistence and trace inspection. */
  message: string;
  /** Provider sub-operation. */
  operation: string;
  /** Whether retrying the failed sub-operation can succeed without user action. */
  retryable: boolean;
}

/** Result and telemetry summary returned by an observed provider collection callback. */
export interface OnboardingUnderstandingProviderCollectionResult<Result> {
  /** Diagnostics produced by the provider collection attempt. */
  diagnostics: readonly OnboardingUnderstandingProviderCollectionDiagnostic[];
  /** Number of evidence items retained by the collection attempt. */
  evidenceCount: number;
  /** Number of failed provider sub-operations. */
  failedCount: number;
  /** Business outcome derived from the usable collected result. */
  outcome: Exclude<OnboardingUnderstandingProviderCollectionOutcome, 'error'>;
  /** Service result returned after telemetry is recorded. */
  result: Result;
  /** Number of source items retained by the collection attempt. */
  sourceCount: number;
  /** Number of successful provider sub-operations. */
  succeededCount: number;
}

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

/** Count of provider collection attempts grouped by provider and business outcome. */
export const providerCollectionCounter = meter.createCounter(
  'onboarding_understanding_provider_collections_total',
  {
    description:
      'Count of onboarding Understanding provider collection attempts grouped by provider and business outcome.',
    unit: '{collection}',
  },
);

/** Duration of provider collection attempts grouped by provider and business outcome. */
export const providerCollectionDurationHistogram = meter.createHistogram(
  'onboarding_understanding_provider_collection_duration',
  {
    description:
      'Duration of onboarding Understanding provider collection attempts grouped by provider and business outcome.',
    unit: 'ms',
  },
);

/** Count of provider collection diagnostics grouped by failure reason. */
export const providerCollectionFailureCounter = meter.createCounter(
  'onboarding_understanding_provider_collection_failures_total',
  {
    description:
      'Count of distinct onboarding Understanding provider collection diagnostics grouped by provider, operation, code, and retryability.',
    unit: '{diagnostic}',
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
 * Builds low-cardinality attributes for provider collection attempt metrics.
 *
 * Use when:
 * - Recording one provider collection attempt and its duration
 *
 * Expects:
 * - Provider identifiers and outcomes come from bounded internal unions or registries
 *
 * Returns:
 * - Metric-safe provider and outcome attributes without session identifiers
 */
export const buildOnboardingUnderstandingProviderCollectionMetricAttributes = (
  providerId: string,
  outcome: OnboardingUnderstandingProviderCollectionOutcome,
): Attributes => ({
  [ATTR_ONBOARDING_UNDERSTANDING_PROVIDER]: providerId,
  [ATTR_ONBOARDING_UNDERSTANDING_PROVIDER_OUTCOME]: outcome,
});

/**
 * Maps a returned provider collection outcome to its aggregate operation status.
 *
 * Use when:
 * - Separating business failures from thrown errors in provider collect metrics
 *
 * Expects:
 * - A provider collection outcome returned without throwing
 *
 * Returns:
 * - `success` only for complete collection; `failed` for partial or unusable results
 */
export const getOnboardingUnderstandingProviderCollectionStatus = (
  outcome: Exclude<OnboardingUnderstandingProviderCollectionOutcome, 'error'>,
): OnboardingUnderstandingOperationStatus => (outcome === 'completed' ? 'success' : 'failed');

/**
 * Builds low-cardinality metric attributes for one provider diagnostic.
 *
 * Use when:
 * - Recording the reason and sub-operation for a provider collection failure
 *
 * Expects:
 * - Provider, code, operation, and retryability are suitable for metric labels
 *
 * Returns:
 * - Metric-safe provider, failure code, operation, and retryability attributes
 */
export const buildOnboardingUnderstandingProviderFailureMetricAttributes = (
  providerId: string,
  diagnostic: OnboardingUnderstandingProviderCollectionDiagnostic,
): Attributes => ({
  [ATTR_ONBOARDING_UNDERSTANDING_FAILURE_CODE]: diagnostic.code,
  [ATTR_ONBOARDING_UNDERSTANDING_FAILURE_OPERATION]: diagnostic.operation,
  [ATTR_ONBOARDING_UNDERSTANDING_FAILURE_RETRYABLE]: diagnostic.retryable,
  [ATTR_ONBOARDING_UNDERSTANDING_PROVIDER]: providerId,
});

/**
 * Builds trace-event attributes for one provider diagnostic.
 *
 * Use when:
 * - Recording provider failures on a correlated Understanding span
 *
 * Expects:
 * - The diagnostic contains the original provider error message
 *
 * Returns:
 * - Correlation attributes plus the original message for production debugging
 */
export const buildOnboardingUnderstandingProviderFailureTraceAttributes = (
  providerId: string,
  diagnostic: OnboardingUnderstandingProviderCollectionDiagnostic,
): Attributes => ({
  ...buildOnboardingUnderstandingProviderFailureMetricAttributes(providerId, diagnostic),
  [ATTR_ONBOARDING_UNDERSTANDING_FAILURE_MESSAGE]: diagnostic.message,
});

const recordProviderCollectionDiagnostic = (
  providerId: string,
  diagnostic: OnboardingUnderstandingProviderCollectionDiagnostic,
  span: Span,
) => {
  const metricAttributes = buildOnboardingUnderstandingProviderFailureMetricAttributes(
    providerId,
    diagnostic,
  );
  providerCollectionFailureCounter.add(1, metricAttributes);
  span.addEvent(
    'onboarding.understanding.provider.failure',
    buildOnboardingUnderstandingProviderFailureTraceAttributes(providerId, diagnostic),
  );
};

/**
 * Observes one provider collection attempt with business-result telemetry.
 *
 * Use when:
 * - A provider can return an unusable or partially usable result without throwing
 * - Provider outcome, duration, counts, and failure reasons must be queryable
 *
 * Expects:
 * - The callback returns diagnostics and a business outcome
 * - The optional error classifier retains the original failure message
 *
 * Returns:
 * - The callback result while recording both generic operation and provider-specific telemetry
 */
export const observeOnboardingUnderstandingProviderCollection = async <Result>(
  attributes: Omit<OnboardingUnderstandingOperationAttributes, 'operation'>,
  operation: () => Promise<OnboardingUnderstandingProviderCollectionResult<Result>>,
  classifyError?: (
    error: unknown,
  ) => OnboardingUnderstandingProviderCollectionDiagnostic | undefined,
): Promise<Result> => {
  const operationAttributes: OnboardingUnderstandingOperationAttributes = {
    ...attributes,
    operation: 'provider.collect',
  };

  return tracer.startActiveSpan(
    'onboarding_understanding.provider.collect',
    { attributes: buildOnboardingUnderstandingTraceAttributes(operationAttributes) },
    async (span) => {
      const startedAt = Date.now();
      let operationStatus: OnboardingUnderstandingOperationStatus | undefined;
      let outcome: OnboardingUnderstandingProviderCollectionOutcome = 'error';

      try {
        const observed = await operation();
        outcome = observed.outcome;
        operationStatus = getOnboardingUnderstandingProviderCollectionStatus(outcome);
        span.setAttributes({
          [ATTR_ONBOARDING_UNDERSTANDING_PROVIDER_EVIDENCE_COUNT]: observed.evidenceCount,
          [ATTR_ONBOARDING_UNDERSTANDING_PROVIDER_FAILED_COUNT]: observed.failedCount,
          [ATTR_ONBOARDING_UNDERSTANDING_PROVIDER_OUTCOME]: outcome,
          [ATTR_ONBOARDING_UNDERSTANDING_PROVIDER_SOURCE_COUNT]: observed.sourceCount,
          [ATTR_ONBOARDING_UNDERSTANDING_PROVIDER_SUCCEEDED_COUNT]: observed.succeededCount,
          [ATTR_ONBOARDING_UNDERSTANDING_STATUS]: operationStatus,
        });

        const distinctDiagnostics = new Map(
          observed.diagnostics.map((diagnostic) => [
            `${diagnostic.code}\u0000${diagnostic.operation}\u0000${diagnostic.retryable}\u0000${diagnostic.message}`,
            diagnostic,
          ]),
        );
        for (const diagnostic of distinctDiagnostics.values()) {
          recordProviderCollectionDiagnostic(attributes.providerId ?? 'provider', diagnostic, span);
        }

        span.setStatus({ code: SpanStatusCode.OK });
        return observed.result;
      } catch (error) {
        operationStatus = 'error';
        const diagnostic = classifyError?.(error);
        if (diagnostic) {
          recordProviderCollectionDiagnostic(attributes.providerId ?? 'provider', diagnostic, span);
        }
        const errorType = error instanceof Error ? error.name : typeof error;
        span.setAttributes({
          [ATTR_ONBOARDING_UNDERSTANDING_PROVIDER_OUTCOME]: outcome,
          [ATTR_ONBOARDING_UNDERSTANDING_STATUS]: operationStatus,
          'error.type': errorType,
        });
        span.setStatus({ code: SpanStatusCode.ERROR, message: errorType });
        span.recordException(error instanceof Error ? error : String(error));
        throw error;
      } finally {
        const duration = Date.now() - startedAt;
        const providerId = attributes.providerId ?? 'provider';
        const metricAttributes = buildOnboardingUnderstandingMetricAttributes(
          operationAttributes,
          operationStatus ?? 'error',
        );
        const providerMetricAttributes =
          buildOnboardingUnderstandingProviderCollectionMetricAttributes(providerId, outcome);
        operationCounter.add(1, metricAttributes);
        operationDurationHistogram.record(duration, metricAttributes);
        providerCollectionCounter.add(1, providerMetricAttributes);
        providerCollectionDurationHistogram.record(duration, providerMetricAttributes);
        span.end();
      }
    },
  );
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
