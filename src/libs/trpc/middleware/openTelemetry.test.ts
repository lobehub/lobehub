import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectSpanTraceHeaders } from '@/libs/observability/traceparent';

// eslint-disable-next-line import/first
import { openTelemetry } from './openTelemetry';

const spanContext = {
  traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  spanId: 'bbbbbbbbbbbbbbbb',
  traceFlags: 1,
};

const mocks = vi.hoisted(() => ({
  capturedMiddleware: undefined as any,
}));

vi.mock('@lobechat/observability-otel/api', () => {
  const tracer = {
    startSpan: vi.fn(() => ({
      spanContext: () => spanContext,
      setStatus: vi.fn(),
      setAttribute: vi.fn(),
      end: vi.fn(),
    })),
  };

  return {
    SpanKind: { SERVER: 'server' },
    SpanStatusCode: { OK: 1, ERROR: 2 },
    context: {
      active: vi.fn(() => ({})),
      with: vi.fn((_ctx, fn) => fn()),
    },
    diag: { debug: vi.fn(), error: vi.fn() },
    trace: {
      getTracer: vi.fn(() => tracer),
      setSpan: vi.fn((_ctx, span) => span),
    },
    propagation: { inject: vi.fn() },
  };
});

vi.mock('../lambda/init', () => {
  const middleware = (fn: any) => {
    mocks.capturedMiddleware = fn;
    return fn;
  };

  return {
    trpc: {
      middleware,
    },
  };
});

vi.mock('@/libs/observability/traceparent', async () => {
  const actual = await vi.importActual<typeof import('@/libs/observability/traceparent')>(
    '@/libs/observability/traceparent',
  );
  return {
    ...actual,
    injectSpanTraceHeaders: vi.fn(actual.injectSpanTraceHeaders),
  };
});

describe('openTelemetry middleware', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ENABLE_TELEMETRY = 'true';
  });

  it('injects trace headers into response headers', async () => {
    const ctx = { resHeaders: new Headers() };
    const middleware = mocks.capturedMiddleware || openTelemetry;

    expect(typeof middleware).toBe('function');

    const result = await middleware({
      ctx: ctx as any,
      getRawInput: () => undefined,
      next: vi.fn().mockResolvedValue({ ok: true, data: null }),
      path: 'foo.bar',
      type: 'query',
    });

    expect(result).toEqual({ ok: true, data: null });
    expect(ctx.resHeaders?.get('traceparent')).toBe(
      '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
    );
    expect(injectSpanTraceHeaders).toHaveBeenCalled();
  });
});
