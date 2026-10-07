import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStageTracer, openStageMark } from '../sendTracing';

const { span, startActiveSpan, startSpan } = vi.hoisted(() => {
  const span = { end: vi.fn(), setAttribute: vi.fn(), setStatus: vi.fn() };
  return {
    span,
    startActiveSpan: vi.fn((_name: string, fn: (span: unknown) => unknown) => fn(span)),
    startSpan: vi.fn(() => span),
  };
});

vi.mock('@lobechat/observability-otel/modules/agent-runtime', () => ({
  tracer: { startActiveSpan, startSpan },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createStageTracer', () => {
  it('names the span after the family and stage and ends it on success', async () => {
    const trace = createStageTracer('execAgent');

    await expect(trace('turn_setup', async () => 'ok')).resolves.toBe('ok');

    expect(startActiveSpan).toHaveBeenCalledWith('execAgent turn_setup', expect.any(Function));
    expect(span.end).toHaveBeenCalledTimes(1);
    expect(span.setStatus).not.toHaveBeenCalled();
  });

  it('marks the span errored, still ends it, and rethrows when the stage throws', async () => {
    const trace = createStageTracer('execAgent');

    await expect(
      trace('agent_config', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(span.setStatus).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
    expect(span.end).toHaveBeenCalledTimes(1);
  });
});

describe('openStageMark', () => {
  it('opens a plain span and closes it from finally on the success path', () => {
    const mark = openStageMark('turn_setup')('topic');
    try {
      expect(startSpan).toHaveBeenCalledWith('turn_setup topic');
      expect(span.end).not.toHaveBeenCalled();
    } finally {
      mark.end();
    }

    expect(span.end).toHaveBeenCalledTimes(1);
    expect(span.setStatus).not.toHaveBeenCalled();
  });

  it('records the error and still closes the span when the block throws', () => {
    const mark = openStageMark('turn_setup')('topic');

    expect(() => {
      try {
        throw new Error('topic missing');
      } catch (error) {
        mark.fail(error);
        throw error;
      } finally {
        mark.end();
      }
    }).toThrow('topic missing');

    expect(span.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'topic missing' }),
    );
    expect(span.end).toHaveBeenCalledTimes(1);
  });
});
