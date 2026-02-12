import { type Mock } from 'vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line import/first
import { getActiveTraceId, injectSpanTraceHeaders } from './traceparent';

vi.mock('@lobechat/observability-otel/api', () => {
  const inject = vi.fn();
  const setSpan = vi.fn((_ctx, span) => span);
  const getActiveSpan = vi.fn();

  return {
    context: {
      active: vi.fn(() => ({})),
    },
    propagation: { inject },
    trace: { getActiveSpan, setSpan },
  };
});

const mockSpan = (traceId: string, spanId: string) =>
  ({
    spanContext: () => ({
      traceId,
      spanId,
      traceFlags: 1,
    }),
  }) as any;

const headersWith = (...args: ConstructorParameters<typeof Headers>) => new Headers(...args);

describe('injectSpanTraceHeaders', () => {
  const api = vi.importMock<typeof import('@lobechat/observability-otel/api')>(
    '@lobechat/observability-otel/api',
  );

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('uses propagator output when available', async () => {
    const { propagation } = await api;
    (
      propagation.inject as unknown as Mock<typeof propagation.inject<Record<string, string>>>
    ).mockImplementation((_ctx, carrier) => {
      carrier.traceparent = 'from-propagator';
      carrier.tracestate = 'state';
    });

    const headers = headersWith();
    const span = mockSpan('abc'.padEnd(32, '0'), '1234567890abcdef');

    const tp = injectSpanTraceHeaders(headers, span);

    expect(tp).toBe('from-propagator');
    expect(headers.get('traceparent')).toBe('from-propagator');
    expect(headers.get('tracestate')).toBe('state');
  });

  it('falls back to manual traceparent formatting when propagator gives none', async () => {
    const { propagation } = await api;
    (
      propagation.inject as unknown as Mock<typeof propagation.inject<Record<string, string>>>
    ).mockImplementation(() => undefined);

    const headers = headersWith();
    const span = mockSpan('1'.repeat(32), '2'.repeat(16));

    const tp = injectSpanTraceHeaders(headers, span);

    expect(tp).toBe('00-11111111111111111111111111111111-2222222222222222-01');
    expect(headers.get('traceparent')).toBe(
      '00-11111111111111111111111111111111-2222222222222222-01',
    );
  });
});

describe('getActiveTraceId', () => {
  const api = vi.importMock<typeof import('@lobechat/observability-otel/api')>(
    '@lobechat/observability-otel/api',
  );

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns traceId from active span', async () => {
    const { trace } = await api;
    const expectedTraceId = 'a'.repeat(32);
    (trace.getActiveSpan as Mock).mockReturnValue(mockSpan(expectedTraceId, 'b'.repeat(16)));

    expect(getActiveTraceId()).toBe(expectedTraceId);
  });

  it('returns undefined when no active span', async () => {
    const { trace } = await api;
    (trace.getActiveSpan as Mock).mockReturnValue(undefined);

    expect(getActiveTraceId()).toBeUndefined();
  });

  it('returns undefined when traceId is all zeros', async () => {
    const { trace } = await api;
    (trace.getActiveSpan as Mock).mockReturnValue(mockSpan('0'.repeat(32), 'b'.repeat(16)));

    expect(getActiveTraceId()).toBeUndefined();
  });
});
