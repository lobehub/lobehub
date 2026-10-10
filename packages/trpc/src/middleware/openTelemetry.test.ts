import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as TraceparentModule from '@/libs/observability/traceparent';
import { injectSpanTraceHeaders } from '@/libs/observability/traceparent';

import { openTelemetry } from './openTelemetry';

const spanContext = {
  traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  spanId: 'bbbbbbbbbbbbbbbb',
  traceFlags: 1,
};

const mocks = vi.hoisted(() => ({
  capturedMiddleware: undefined as any,
  span: undefined as any,
}));

vi.mock('@lobechat/observability-otel/api', () => {
  const tracer = {
    startSpan: vi.fn(() => {
      mocks.span = {
        spanContext: () => spanContext,
        recordException: vi.fn(),
        setStatus: vi.fn(),
        setAttribute: vi.fn(),
        end: vi.fn(),
      };
      return mocks.span;
    }),
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
  const actual = await vi.importActual<typeof TraceparentModule>(
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

  it('reports the explicit error name even when the class name is mangled', async () => {
    class MangledError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'BusinessError';
      }
    }
    // Simulate a minified production bundle renaming the class
    Object.defineProperty(MangledError, 'name', { value: 'x' });

    const middleware = mocks.capturedMiddleware || openTelemetry;
    const error = new MangledError('boom');

    await expect(
      middleware({
        ctx: { resHeaders: new Headers() } as any,
        getRawInput: () => undefined,
        next: vi.fn().mockRejectedValue(error),
        path: 'foo.bar',
        type: 'query',
      }),
    ).rejects.toBe(error);

    expect(mocks.span.setAttribute).toHaveBeenCalledWith('error.type', 'BusinessError');
    expect(mocks.span.setAttribute).not.toHaveBeenCalledWith('error.type', 'x');
  });
});
