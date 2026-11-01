// @vitest-environment node
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { markDegradedStage, traceDiscoveryStage } from '../discoveryTracing';

const { span, startActiveSpan } = vi.hoisted(() => {
  const span = { end: vi.fn(), setAttribute: vi.fn(), setStatus: vi.fn() };
  return {
    span,
    startActiveSpan: vi.fn((_name: string, fn: (span: unknown) => unknown) => fn(span)),
  };
});

vi.mock('@lobechat/observability-otel/modules/agent-runtime', () => ({
  tracer: { startActiveSpan },
}));

describe('traceDiscoveryStage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names the span after the stage and ends it on success', async () => {
    await expect(traceDiscoveryStage('composio', async () => 'ok')).resolves.toBe('ok');

    expect(startActiveSpan).toHaveBeenCalledWith('tool_discovery composio', expect.any(Function));
    expect(span.setStatus).not.toHaveBeenCalled();
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('marks the span as errored, rethrows, and still ends it', async () => {
    const error = new Error('gateway down');

    await expect(
      traceDiscoveryStage('online_devices', async () => {
        throw error;
      }),
    ).rejects.toBe(error);

    expect(span.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'gateway down',
    });
    expect(span.end).toHaveBeenCalledTimes(1);
  });
});

describe('markDegradedStage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks a stage that absorbed failures as errored', () => {
    markDegradedStage(span as any, 2, 'skill discovery requests');

    expect(span.setAttribute).toHaveBeenCalledWith('lobehub.tool_discovery.failure_count', 2);
    expect(span.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: '2 skill discovery requests failed',
    });
  });

  it('leaves a clean stage unmarked', () => {
    markDegradedStage(span as any, 0, 'metadata lookups');

    expect(span.setAttribute).toHaveBeenCalledWith('lobehub.tool_discovery.failure_count', 0);
    expect(span.setStatus).not.toHaveBeenCalled();
  });
});
