import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { afterEach, describe, expect, it } from 'vitest';

import { recordSearchReindexBulkRetry } from '.';

/** Keep this file single-test because instrument memoization intentionally models one CLI process. */
describe('search reindex metric registration order', () => {
  let provider: MeterProvider | undefined;

  afterEach(async () => {
    await provider?.shutdown();
    metrics.disable();
  });

  it('binds instruments to a provider registered after the module import', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({
      exportIntervalMillis: 60_000,
      exporter,
    });
    provider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(provider);

    recordSearchReindexBulkRetry('messages');
    await provider.forceFlush();

    const metricNames = exporter
      .getMetrics()
      .flatMap(({ scopeMetrics }) => scopeMetrics)
      .flatMap(({ metrics }) => metrics)
      .map(({ descriptor }) => descriptor.name);
    expect(metricNames).toContain('search_reindex_bulk_retries_total');
  });
});
