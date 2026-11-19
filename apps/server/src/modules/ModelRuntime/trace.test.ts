// @vitest-environment node
import { LOBE_CHAT_OBSERVATION_ID, LOBE_CHAT_TRACE_ID } from '@lobechat/const';
import { TraceTagMap } from '@lobechat/types';
import type * as SdkTraceBase from '@opentelemetry/sdk-trace-base';
import type { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as server from '@/envs/langfuse';

import { createTraceOptions } from './trace';

const { afterWork, clientFlush, exporter } = vi.hoisted(() => ({
  afterWork: [] as (() => Promise<void>)[],
  clientFlush: vi.fn(),
  exporter: { current: undefined as InMemorySpanExporter | undefined },
}));

vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  after: (work: () => Promise<void>) => afterWork.push(work),
}));

vi.mock('@langfuse/otel', async () => {
  const { InMemorySpanExporter, SimpleSpanProcessor } = await vi.importActual<typeof SdkTraceBase>(
    '@opentelemetry/sdk-trace-base',
  );

  return {
    LangfuseSpanProcessor: class extends SimpleSpanProcessor {
      constructor() {
        exporter.current = new InMemorySpanExporter();
        super(exporter.current);
      }
    },
  };
});

vi.mock('@langfuse/client', () => ({
  LangfuseClient: class {
    flush = clientFlush;
    score = { create: vi.fn() };
  },
}));

const payload = {
  messages: [
    { content: 'You are helpful.', role: 'system' },
    { content: 'hi', role: 'user' },
  ],
  model: 'glm-5',
  temperature: 0.7,
  thinking: { budget_tokens: 1024, type: 'enabled' },
  tools: undefined,
} as any;

const trace = {
  enabled: true,
  sessionId: 'agent-1',
  tags: ['chat'],
  topicId: 'topic-1',
  traceName: 'Conversation',
  userId: 'user-1',
} as any;

const spans = () => {
  const finished = exporter.current!.getFinishedSpans();
  return {
    generation: finished.find((span) => span.name === 'Chat Completion (newapi)'),
    root: finished.find((span) => span.name === 'Conversation'),
  };
};

beforeEach(() => {
  afterWork.length = 0;
  clientFlush.mockReset();
  vi.spyOn(server, 'getLangfuseConfig').mockReturnValue({
    ENABLE_LANGFUSE: true,
    LANGFUSE_HOST: 'https://cloud.langfuse.com',
    LANGFUSE_PUBLIC_KEY: 'pk-lf-test',
    LANGFUSE_SECRET_KEY: 'sk-lf-test',
  } as any);
  exporter.current?.reset();
});

describe('createTraceOptions', () => {
  it('returns the OpenTelemetry trace and generation ids in the response headers', () => {
    const { callback, headers } = createTraceOptions(payload, { provider: 'newapi', trace });
    callback.onFinal!({} as any);

    const { generation, root } = spans();
    expect(headers.get(LOBE_CHAT_TRACE_ID)).toBe(root!.spanContext().traceId);
    expect(headers.get(LOBE_CHAT_OBSERVATION_ID)).toBe(generation!.spanContext().spanId);
    expect(headers.get(LOBE_CHAT_TRACE_ID)).toMatch(/^[\da-f]{32}$/);
    expect(headers.get(LOBE_CHAT_OBSERVATION_ID)).toMatch(/^[\da-f]{16}$/);
  });

  it('records a completed chat and flushes after the response', async () => {
    const { callback } = createTraceOptions(payload, { provider: 'newapi', trace });

    callback.onStart!();
    await callback.onToolsCalling!({} as any);
    await callback.onCompletion!({
      text: 'hello',
      thinking: 'because',
      usage: { totalInputTokens: 12, totalOutputTokens: 5, totalTokens: 17 },
    } as any);
    callback.onFinal!({} as any);

    const { generation, root } = spans();
    expect(generation!.attributes['langfuse.observation.model.name']).toBe('glm-5');
    expect(generation!.attributes['langfuse.observation.completion_start_time']).toBeDefined();
    expect(JSON.parse(generation!.attributes['langfuse.observation.output'] as string)).toEqual({
      text: 'hello',
      thinking: 'because',
    });
    expect(
      JSON.parse(generation!.attributes['langfuse.observation.usage_details'] as string),
    ).toEqual({ input: 12, output: 5, total: 17 });
    expect(JSON.parse(root!.attributes['langfuse.observation.output'] as string)).toEqual({
      text: 'hello',
      thinking: 'because',
    });

    for (const span of [root!, generation!]) {
      expect(span.attributes).toMatchObject({
        'langfuse.trace.name': 'Conversation',
        'langfuse.trace.tags': ['chat', TraceTagMap.ToolsCalling],
        'session.id': 'topic-1',
        'user.id': 'user-1',
      });
    }

    expect(afterWork).toHaveLength(1);
    await afterWork[0]();
    expect(clientFlush).toHaveBeenCalledTimes(1);
  });

  // https://github.com/lobehub/lobehub/issues/15405
  it('sends structured model parameters such as thinking as JSON strings', () => {
    const { callback } = createTraceOptions(payload, { provider: 'newapi', trace });
    callback.onFinal!({} as any);

    const parameters = JSON.parse(
      spans().generation!.attributes['langfuse.observation.model.parameters'] as string,
    );
    expect(parameters).toEqual({
      temperature: 0.7,
      thinking: JSON.stringify({ budget_tokens: 1024, type: 'enabled' }),
    });
  });

  it('exports the trace when the stream ends without a completion', () => {
    const { callback } = createTraceOptions(payload, { provider: 'newapi', trace });
    callback.onFinal!({} as any);

    const { generation, root } = spans();
    expect(root).toBeDefined();
    expect(generation).toBeDefined();
  });
});
