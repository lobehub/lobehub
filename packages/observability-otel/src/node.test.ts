import type { ViewOptions } from '@opentelemetry/sdk-metrics';
import { AggregationType, MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { describe, expect, it, vi } from 'vitest';

import {
  attributesCommon,
  buildMetricViews,
  parseMetricsDropPatterns,
  register,
  shutdownSafely,
} from './node';

const mocks = vi.hoisted(() => ({
  nodeSdkOptions: undefined as Record<string, unknown> | undefined,
  start: vi.fn(),
}));

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: vi.fn(function NodeSDK(options: Record<string, unknown>) {
    mocks.nodeSdkOptions = options;
    return { start: mocks.start };
  }),
}));

describe('Node observability resource attributes', () => {
  it('uses one stable UUID for the service instance during the process lifetime', () => {
    const first = attributesCommon()['service.instance.id'];
    const second = attributesCommon()['service.instance.id'];

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('can disable process resource detection for privacy-sensitive CLI execution', () => {
    register({ autoDetectResources: false, autoInstrumentations: false });

    expect(mocks.nodeSdkOptions).toMatchObject({
      autoDetectResources: false,
      instrumentations: [],
    });
  });

  it('translates explicit histogram boundaries into SDK views', () => {
    register({
      autoInstrumentations: false,
      histogramViews: [
        {
          boundaries: [1000, 3000, 5000],
          instrumentName: 'fts_search_backend_operation_duration',
          meterName: 'fts-search-backend',
        },
      ],
    });

    expect(mocks.nodeSdkOptions).toMatchObject({
      views: [
        {
          aggregation: { options: { boundaries: [1000, 3000, 5000] } },
          instrumentName: 'fts_search_backend_operation_duration',
          meterName: 'fts-search-backend',
        },
      ],
    });
  });

  it('registers Sentry and OTLP processors on one tracer provider', () => {
    const contextManager = { name: 'sentry-context-manager' };
    const sampler = { name: 'sentry-sampler' };
    const sentrySpanProcessor = { name: 'sentry-span-processor' };
    const textMapPropagator = { name: 'sentry-propagator' };

    register({
      contextManager,
      sampler,
      spanProcessors: [sentrySpanProcessor],
      textMapPropagator,
    } as unknown as Parameters<typeof register>[0]);

    expect(mocks.nodeSdkOptions).toMatchObject({
      contextManager,
      sampler,
      textMapPropagator,
    });
    expect(mocks.nodeSdkOptions?.traceExporter).toBeUndefined();
    expect(mocks.nodeSdkOptions?.spanProcessors).toEqual([sentrySpanProcessor, expect.any(Object)]);
  });

  it('does not expose telemetry shutdown failures to the caller', async () => {
    const shutdown = vi.fn().mockRejectedValue(new Error('collector unavailable'));

    await expect(shutdownSafely({ shutdown })).resolves.toBeUndefined();
    expect(shutdown).toHaveBeenCalledOnce();
  });
});

const collectInstrumentNames = async (views: ViewOptions[]) => {
  const reader = new TestMetricReader();
  const provider = new MeterProvider({ readers: [reader], views });
  const meter = provider.getMeter('fts-search-backend');

  meter.createHistogram('fts_search_backend_operation_duration').record(120);
  meter.createHistogram('fts_search_sync_bulk_request_duration').record(80);
  meter.createHistogram('http.client.request.duration').record(0.2);
  meter.createCounter('rpc_server_requests').add(1);

  const { resourceMetrics } = await reader.collect();
  await provider.shutdown();
  return resourceMetrics.scopeMetrics.flatMap((scope) =>
    scope.metrics.map((metric) => metric.descriptor.name),
  );
};

class TestMetricReader extends MetricReader {
  protected async onForceFlush() {}
  protected async onShutdown() {}
}

describe('OTEL_METRICS_DROP', () => {
  it('accepts exact names and trailing-wildcard prefixes only', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(
      parseMetricsDropPatterns(
        ' fts_search_backend_*, http.client.*,,exact_metric , *, *mid*, a*b ',
      ),
    ).toEqual(['fts_search_backend_*', 'http.client.*', 'exact_metric']);
    expect(parseMetricsDropPatterns(undefined)).toEqual([]);

    /** Visible even when the caller set the OTEL diag level to ERROR, as Cloud does. */
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining('"*"'),
      expect.stringContaining('"*mid*"'),
      expect.stringContaining('"a*b"'),
    ]);
    warn.mockRestore();
  });

  it('stops exporting matched instruments and keeps the rest', async () => {
    const names = await collectInstrumentNames(
      buildMetricViews([], ['fts_search_backend_*', 'http.client.*']),
    );

    expect(names).toEqual(['fts_search_sync_bulk_request_duration', 'rpc_server_requests']);
  });

  it('drops a histogram even when an explicit bucket view targets it', async () => {
    const histogramViews = [
      {
        boundaries: [100, 1000],
        instrumentName: 'fts_search_backend_operation_duration',
        meterName: 'fts-search-backend',
      },
      {
        boundaries: [100, 1000],
        instrumentName: 'fts_search_sync_bulk_request_duration',
        meterName: 'fts-search-backend',
      },
    ];

    const views = buildMetricViews(histogramViews, ['fts_search_backend_*']);

    /**
     * When several views match one instrument, the SDK keeps the stream of the first one, so a
     * bucket view ordered before the drop view would re-enable the metric. Check both orders.
     */
    for (const ordered of [views, views.toReversed()]) {
      const names = await collectInstrumentNames(ordered);

      expect(names).not.toContain('fts_search_backend_operation_duration');
      expect(names).toContain('fts_search_sync_bulk_request_duration');
    }
  });

  it('reads the drop list from the environment when registering', () => {
    vi.stubEnv('OTEL_METRICS_DROP', 'fts_search_backend_*');
    register({
      autoInstrumentations: false,
      histogramViews: [
        {
          boundaries: [1000],
          instrumentName: 'fts_search_backend_operation_duration',
          meterName: 'fts-search-backend',
        },
      ],
    });
    vi.unstubAllEnvs();

    expect(mocks.nodeSdkOptions?.views).toEqual([
      { aggregation: { type: AggregationType.DROP }, instrumentName: 'fts_search_backend_*' },
    ]);
  });
});
