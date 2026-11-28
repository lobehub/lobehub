import { randomUUID } from 'node:crypto';
import { env } from 'node:process';

import type { ContextManager, TextMapPropagator } from '@opentelemetry/api';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import type { DetectedResourceAttributes } from '@opentelemetry/resources';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { ViewOptions } from '@opentelemetry/sdk-metrics';
import { AggregationType, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { Sampler, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

/**
 * One opaque ID per Node.js process matches the Vercel instance lifetime, including Fluid
 * Compute reuse across concurrent invocations.
 * @see https://opentelemetry.io/docs/specs/semconv/resource/service/
 */
const SERVICE_INSTANCE_ID = randomUUID();

export function attributesForVercel(): DetectedResourceAttributes {
  return {
    // Vercel.
    // https://vercel.com/docs/projects/environment-variables/system-environment-variables
    // Vercel Env set as top level attribute for simplicity. One of 'production', 'preview' or 'development'.
    'env': process.env.VERCEL_ENV || process.env.NEXT_PUBLIC_VERCEL_ENV,

    'vercel.branch_host':
      process.env.VERCEL_BRANCH_URL || process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL || undefined,
    'vercel.deployment_id': process.env.VERCEL_DEPLOYMENT_ID || undefined,
    'vercel.host': process.env.VERCEL_URL || process.env.NEXT_PUBLIC_VERCEL_URL || undefined,
    'vercel.project_id': process.env.VERCEL_PROJECT_ID || undefined,
    'vercel.region': process.env.VERCEL_REGION,
    'vercel.runtime': process.env.NEXT_RUNTIME || 'nodejs',
    'vercel.sha':
      process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,

    'service.version': process.env.VERCEL_DEPLOYMENT_ID,
  };
}

export function attributesForNodejs(): DetectedResourceAttributes {
  return {
    // Node.
    'node.ci': process.env.CI ? true : undefined,
    'node.env': process.env.NODE_ENV,
  };
}

export function attributesForEnv(): DetectedResourceAttributes {
  return {
    ...attributesForVercel(),
    ...attributesForNodejs(),
  };
}

export function attributesCommon(): DetectedResourceAttributes {
  return {
    [ATTR_SERVICE_NAME]: 'lobehub',
    'service.instance.id': SERVICE_INSTANCE_ID,
    ...attributesForEnv(),
  };
}

function debugLogLevelFromString(level?: string | null): DiagLogLevel | undefined {
  if (!level) {
    return undefined;
  }
  if (typeof level !== 'string') {
    return undefined;
  }

  switch (level.toLowerCase()) {
    case 'none': {
      return DiagLogLevel.NONE;
    }
    case 'error': {
      return DiagLogLevel.ERROR;
    }
    case 'warn': {
      return DiagLogLevel.WARN;
    }
    case 'info': {
      return DiagLogLevel.INFO;
    }
    case 'debug': {
      return DiagLogLevel.DEBUG;
    }
    case 'verbose': {
      return DiagLogLevel.VERBOSE;
    }
    case 'all': {
      return DiagLogLevel.ALL;
    }
    default: {
      return undefined;
    }
  }
}

export interface RegisterOptions {
  autoDetectResources?: boolean;
  autoInstrumentations?: boolean;
  contextManager?: ContextManager;
  debug?: true | DiagLogLevel;
  environment?: string;
  histogramViews?: {
    boundaries: readonly number[];
    instrumentName: string;
    meterName?: string;
  }[];
  name?: string;
  sampler?: Sampler;
  spanProcessors?: SpanProcessor[];
  textMapPropagator?: TextMapPropagator;
  version?: string;
}

/**
 * Parses `OTEL_METRICS_DROP`: a comma-separated list of instrument names whose measurements are
 * dropped before export. Each entry is an exact instrument name or a prefix ending in one `*`
 * (for example `fts_search_backend_*` or `http.client.*`). Entries use OpenTelemetry instrument
 * names, not the Prometheus series names derived from them (`http.client.request.duration`, not
 * `http_client_request_duration_seconds`).
 *
 * Other wildcard shapes are ignored: the SDK matcher only expands the first `*`, so `*foo*` would
 * not mean what it looks like, and a bare `*` would silently stop every metric.
 */
export function parseMetricsDropPatterns(value?: string): string[] {
  if (!value) return [];

  const patterns: string[] = [];
  for (const raw of value.split(',')) {
    const pattern = raw.trim();
    if (!pattern) continue;

    const wildcardIndex = pattern.indexOf('*');
    const isExact = wildcardIndex === -1;
    const isPrefix = wildcardIndex === pattern.length - 1 && wildcardIndex > 0;
    if (!isExact && !isPrefix) {
      /**
       * `console.warn`, not `diag.warn`: callers commonly raise the diag level to ERROR, which would
       * hide the warning and leave the operator unaware that the metric is still exported.
       */
      console.warn(
        `[observability-otel] ignoring unsupported OTEL_METRICS_DROP entry "${pattern}"`,
      );
      continue;
    }
    patterns.push(pattern);
  }
  return patterns;
}

const matchesDropPattern = (instrumentName: string, pattern: string) =>
  pattern.endsWith('*')
    ? instrumentName.startsWith(pattern.slice(0, -1))
    : instrumentName === pattern;

/**
 * Builds SDK views from explicit histogram boundaries and drop patterns.
 *
 * A histogram view whose instrument is dropped is omitted: when several views match one
 * instrument, the SDK keeps the stream of the first one, so a bucket view ordered before the drop
 * view would silently export the histogram again.
 */
export function buildMetricViews(
  histogramViews: RegisterOptions['histogramViews'] = [],
  dropPatterns: readonly string[] = [],
): ViewOptions[] {
  const isDropped = (instrumentName: string) =>
    dropPatterns.some((pattern) => matchesDropPattern(instrumentName, pattern));

  return [
    ...dropPatterns.map((instrumentName) => ({
      aggregation: { type: AggregationType.DROP },
      instrumentName,
    })),
    ...histogramViews
      .filter(({ instrumentName }) => !isDropped(instrumentName))
      .map(({ boundaries, instrumentName, meterName }) => ({
        aggregation: {
          options: { boundaries: [...boundaries] },
          type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
        },
        instrumentName,
        meterName,
      })),
  ];
}

export function register(options?: RegisterOptions) {
  const attributes = attributesCommon();

  if (typeof options?.environment !== 'undefined') {
    attributes.env = options.environment;
  }
  if (typeof options?.name !== 'undefined') {
    attributes[ATTR_SERVICE_NAME] = options.name;
  }
  if (typeof options?.version !== 'undefined') {
    attributes[ATTR_SERVICE_VERSION] = options.version;
  }
  if (typeof options?.debug !== 'undefined' || env.OTEL_JS_LOBEHUB_DIAG) {
    const levelFromEnv = debugLogLevelFromString(env.OTEL_JS_LOBEHUB_DIAG);

    diag.setLogger(
      new DiagConsoleLogger(),
      !!levelFromEnv ? levelFromEnv : options?.debug === true ? DiagLogLevel.DEBUG : options?.debug,
    );
  }

  let metricsExporterInterval = 1000;
  if (env.OTEL_METRICS_EXPORTER_INTERVAL) {
    const parsed = parseInt(env.OTEL_METRICS_EXPORTER_INTERVAL, 10);
    if (!isNaN(parsed)) {
      metricsExporterInterval = parsed;
    }
  }

  const sdk = new NodeSDK({
    autoDetectResources: options?.autoDetectResources,
    contextManager: options?.contextManager,
    instrumentations:
      options?.autoInstrumentations === false
        ? []
        : [new PgInstrumentation(), new HttpInstrumentation(), getNodeAutoInstrumentations()],
    metricReaders: [
      new PeriodicExportingMetricReader({
        exportIntervalMillis: metricsExporterInterval,
        exporter: new OTLPMetricExporter(),
      }),
    ],
    resource: resourceFromAttributes(attributes),
    sampler: options?.sampler,
    spanProcessors: [
      ...(options?.spanProcessors ?? []),
      new BatchSpanProcessor(new OTLPTraceExporter()),
    ],
    textMapPropagator: options?.textMapPropagator,
    views: buildMetricViews(
      options?.histogramViews,
      parseMetricsDropPatterns(env.OTEL_METRICS_DROP),
    ),
  });

  sdk.start();
  return sdk;
}

export const shutdownSafely = async (sdk: Pick<NodeSDK, 'shutdown'>): Promise<void> => {
  try {
    await sdk.shutdown();
  } catch (error) {
    /** Exporter shutdown failures must not change the caller's business result or exit status. */
    diag.error('[observability-otel] failed to shut down telemetry', error);
  }
};

export { DiagLogLevel } from '@opentelemetry/api';
