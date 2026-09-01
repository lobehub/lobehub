import type { Context, ContextManager, TextMapPropagator } from '@opentelemetry/api';
import { ROOT_CONTEXT } from '@opentelemetry/api';
import { AlwaysOnSampler, NoopSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it, vi } from 'vitest';

import { attributesCommon, register, shutdownSafely } from './node';

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

class PassthroughContextManager implements ContextManager {
  active(): Context {
    return ROOT_CONTEXT;
  }

  bind<T>(_context: Context, target: T): T {
    return target;
  }

  disable(): this {
    return this;
  }

  enable(): this {
    return this;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    _context: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return fn.call(thisArg, ...args);
  }
}

const passthroughPropagator: TextMapPropagator = {
  extract: (context) => context,
  fields: () => [],
  inject: () => {},
};

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
    const contextManager = new PassthroughContextManager();
    const sampler = new AlwaysOnSampler();
    const sentrySpanProcessor = new NoopSpanProcessor();
    const textMapPropagator = passthroughPropagator;

    register({
      contextManager,
      sampler,
      spanProcessors: [sentrySpanProcessor],
      textMapPropagator,
    });

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
