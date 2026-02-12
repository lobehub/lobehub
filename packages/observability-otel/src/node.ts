/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import { env } from 'node:process';

import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import type { DetectedResourceAttributes } from '@opentelemetry/resources';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

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

export function register(options?: {
  debug?: true | DiagLogLevel;
  name?: string;
  version?: string;
}) {
  const attributes = attributesCommon();

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
    instrumentations: [
      new PgInstrumentation(),
      new HttpInstrumentation(),
      getNodeAutoInstrumentations(),
    ],
    metricReaders: [
      new PeriodicExportingMetricReader({
        exportIntervalMillis: metricsExporterInterval,
        exporter: new OTLPMetricExporter(),
      }),
    ],
    resource: resourceFromAttributes(attributes),
    traceExporter: new OTLPTraceExporter(),
  });

  sdk.start();
}

export { DiagLogLevel } from '@opentelemetry/api';
