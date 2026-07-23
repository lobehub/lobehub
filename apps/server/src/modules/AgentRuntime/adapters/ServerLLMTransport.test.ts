import type { LLMTraceInput } from '@lobechat/agent-runtime';
import type * as AgentRuntimeObservability from '@lobechat/observability-otel/modules/agent-runtime';
import { ATTR_GEN_AI_RESPONSE_TIME_TO_FIRST_CHUNK } from '@lobechat/observability-otel/modules/agent-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeExecutorContext } from '../context';
import { ServerLLMTransport } from './ServerLLMTransport';

const mocks = vi.hoisted(() => {
  const chatSpan = {
    addEvent: vi.fn(),
    end: vi.fn(),
    recordException: vi.fn(),
    setAttribute: vi.fn(),
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
  };

  return {
    chatSpan,
    startSpan: vi.fn(() => chatSpan),
  };
});

vi.mock('@lobechat/observability-otel/modules/agent-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentRuntimeObservability>();

  return {
    ...actual,
    tracer: { startSpan: mocks.startSpan },
  };
});

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

describe('ServerLLMTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T00:00:00.000Z'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records time to first chunk immediately even when the call never completes', () => {
    const transport = new ServerLLMTransport({
      operationId: 'operation-1',
      stepIndex: 2,
      streamManager: {},
    } as RuntimeExecutorContext);
    const trace = transport.createTrace({
      assistantMessageId: 'message-1',
      model: 'test-model',
      provider: 'test-provider',
    } satisfies LLMTraceInput);

    vi.advanceTimersByTime(1250);
    trace.onFirstChunk();
    trace.onFirstChunk();

    expect(mocks.chatSpan.setAttribute).toHaveBeenCalledOnce();
    expect(mocks.chatSpan.setAttribute).toHaveBeenCalledWith(
      ATTR_GEN_AI_RESPONSE_TIME_TO_FIRST_CHUNK,
      1.25,
    );
    expect(mocks.chatSpan.addEvent).toHaveBeenCalledOnce();
    expect(mocks.chatSpan.addEvent).toHaveBeenCalledWith('gen_ai.first_chunk', {
      [ATTR_GEN_AI_RESPONSE_TIME_TO_FIRST_CHUNK]: 1.25,
    });
  });
});
