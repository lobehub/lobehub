import { LangfuseSpanProcessor } from '@langfuse/otel';
import { LangfuseOtelSpanAttributes as A } from '@langfuse/tracing';
import { LOBE_CHAT_OBSERVATION_ID, LOBE_CHAT_TRACE_ID } from '@lobechat/const';
import { type ChatStreamPayload } from '@lobechat/model-runtime';
import { TraceTagMap } from '@lobechat/types';
import { context, ROOT_CONTEXT, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Traces from '@/libs/traces';

import { StreamingResponse } from '../../../../../packages/model-runtime/src/utils/response';
import { createTraceOptions } from './trace';

const mocks = vi.hoisted(() => ({
  enabled: true,
  flush: vi.fn(),
  scheduled: [] as (() => Promise<void>)[],
}));
vi.mock('@/libs/traces', async (importOriginal) => ({
  ...(await importOriginal<typeof Traces>()),
  getLangfuseSpanProcessor: () => (mocks.enabled ? {} : undefined),
  flushTraces: () => mocks.flush(),
}));
vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  after: (work: () => Promise<void>) => {
    mocks.scheduled.push(work);
  },
}));

const exporter = new InMemorySpanExporter();
const processor = new LangfuseSpanProcessor({
  exporter,
  publicKey: 'pk-test',
  secretKey: 'sk-test',
  mediaUploadEnabled: false,
});
const provider = new BasicTracerProvider({ spanProcessors: [processor] });
const payload = {
  messages: [{ role: 'user', content: 'hello' }],
  model: 'test-model',
  temperature: 0.5,
} as ChatStreamPayload;
const options = {
  provider: 'openai',
  trace: { enabled: true, userId: 'user-1', topicId: 'topic-1', tags: ['chat'] },
};
const flush = async () => {
  for (const work of mocks.scheduled.splice(0)) await work();
  await processor.forceFlush();
};
const spans = () => exporter.getFinishedSpans();

beforeAll(() => {
  trace.setGlobalTracerProvider(provider);
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
});
beforeEach(() => {
  exporter.reset();
  mocks.scheduled = [];
  mocks.enabled = true;
  mocks.flush.mockReset().mockImplementation(() => processor.forceFlush());
});
afterAll(async () => {
  await provider.shutdown();
  context.disable();
  trace.disable();
});

describe('Langfuse chat observations', () => {
  it('returns usable trace IDs through the real streaming response builder', async () => {
    const result = (await createTraceOptions(payload, options))!;
    const response = StreamingResponse(
      new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      { headers: result.headers },
    );
    expect(response.headers.get(LOBE_CHAT_TRACE_ID)).toMatch(/^[0-9a-f]{32}$/);
    expect(response.headers.get(LOBE_CHAT_OBSERVATION_ID)).toMatch(/^[0-9a-f]{16}$/);
    result.finish();
    await flush();
  });

  it('exports a complete root and nested generation with propagated attributes and usage', async () => {
    const result = (await createTraceOptions(payload, options))!;
    await result.callback.onText?.('answer');
    expect(spans()).toHaveLength(0);
    await result.callback.onFinal?.({
      text: 'answer',
      usage: { totalInputTokens: 10, totalOutputTokens: 5, totalTokens: 15 },
    } as never);
    await flush();
    expect(spans()).toHaveLength(2);
    const generation = spans().find((span) => span.name === 'Chat Completion (openai)')!;
    const root = spans().find((span) => span.name === 'Chat Completion')!;
    expect(generation.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    expect(root.parentSpanContext).toBeUndefined();
    for (const span of spans()) {
      expect(span.attributes).toMatchObject({
        'user.id': 'user-1',
        'session.id': 'topic-1',
        [A.OBSERVATION_OUTPUT]: 'answer',
        [A.TRACE_TAGS]: ['chat'],
      });
      expect(JSON.stringify(span.attributes)).toContain('hello');
    }
    expect(generation.attributes[A.OBSERVATION_USAGE_DETAILS]).toBe(
      JSON.stringify({ input: 10, output: 5, total: 15 }),
    );
    expect(generation.attributes[A.OBSERVATION_COMPLETION_START_TIME]).toBeDefined();
    expect(result.headers[LOBE_CHAT_TRACE_ID]).toBe(root.spanContext().traceId);
    expect(result.headers[LOBE_CHAT_OBSERVATION_ID]).toBe(generation.spanContext().spanId);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
  });

  it('does not create observations without both server enablement and user opt-in', async () => {
    expect(
      await createTraceOptions(payload, { ...options, trace: { enabled: false } }),
    ).toBeUndefined();
    expect(await createTraceOptions(payload, { provider: 'openai' })).toBeUndefined();
    mocks.enabled = false;
    expect(await createTraceOptions(payload, options)).toBeUndefined();
    await flush();
    expect(spans()).toHaveLength(0);
  });

  it('isolates concurrent requests and ignores incoming unsampled infrastructure context', async () => {
    const incoming = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: '11111111111111111111111111111111',
      spanId: '1111111111111111',
      traceFlags: 0,
    });
    const [first, second] = await context.with(incoming, () =>
      Promise.all([
        createTraceOptions(payload, options),
        createTraceOptions(payload, {
          ...options,
          trace: { enabled: true, userId: 'user-2', sessionId: 'agent-2' },
        }),
      ]),
    );
    await second!.callback.onFinal?.({ text: 'second' } as never);
    await first!.callback.onFinal?.({ text: 'first' } as never);
    await flush();
    expect(spans()).toHaveLength(4);
    expect(first!.headers[LOBE_CHAT_TRACE_ID]).not.toBe(second!.headers[LOBE_CHAT_TRACE_ID]);
    for (const span of spans()) {
      expect(span.spanContext().traceId).not.toBe('11111111111111111111111111111111');
      const isFirst = span.attributes[A.OBSERVATION_OUTPUT] === 'first';
      expect(span.attributes['user.id']).toBe(isFirst ? 'user-1' : 'user-2');
      expect(span.attributes['session.id']).toBe(isFirst ? 'topic-1' : 'agent-2@default');
    }
  });

  it('preserves W3C trace IDs when continuing a conversation', async () => {
    const traceId = '1234567890abcdef1234567890abcdef';
    const result = (await createTraceOptions(payload, {
      ...options,
      trace: { ...options.trace, traceId },
    }))!;
    expect(result.headers[LOBE_CHAT_TRACE_ID]).toBe(traceId);
    result.finish();
    await flush();
    expect(spans().every((span) => span.spanContext().traceId === traceId)).toBe(true);
  });

  it('records tool output and adds the tool-call tag to both observations before ending', async () => {
    const result = (await createTraceOptions(payload, options))!;
    await result.callback.onToolsCalling?.({ chunk: [], toolsCalling: [] });
    await result.callback.onFinal?.({
      text: '',
      toolsCalling: [{ id: 'call-1', function: { name: 'search', arguments: '{}' } }],
    } as never);
    await flush();
    for (const span of spans()) {
      expect(span.attributes[A.TRACE_TAGS]).toEqual(['chat', TraceTagMap.ToolsCalling]);
      expect(String(span.attributes[A.OBSERVATION_OUTPUT])).toContain('call-1');
    }
  });

  it('ends aborted observations once with partial content and keeps the exporter usable', async () => {
    const controller = new AbortController();
    const result = (await createTraceOptions(payload, { ...options, signal: controller.signal }))!;
    await result.callback.onText?.('partial');
    controller.abort();
    await result.callback.onFinal?.({ text: 'late' } as never);
    result.finish();
    await flush();
    expect(spans()).toHaveLength(2);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    for (const span of spans())
      expect(span.attributes).toMatchObject({
        [A.OBSERVATION_LEVEL]: 'WARNING',
        [A.OBSERVATION_OUTPUT]: 'partial',
      });
    const next = (await createTraceOptions(payload, options))!;
    next.finish();
    await flush();
    expect(spans()).toHaveLength(4);
  });

  it('finalizes already-aborted requests and startup failures without leaking open observations', async () => {
    const aborted = new AbortController();
    aborted.abort();
    await createTraceOptions(payload, { ...options, signal: aborted.signal });
    const failed = (await createTraceOptions(payload, options))!;
    failed.finish(new Error('provider unavailable'));
    await flush();
    expect(spans()).toHaveLength(4);
    expect(spans().filter((span) => span.attributes[A.OBSERVATION_LEVEL] === 'ERROR')).toHaveLength(
      2,
    );
  });

  it('keeps provider stream errors on final observations', async () => {
    const result = (await createTraceOptions(payload, options))!;
    await result.callback.onError?.({ message: 'rate limited' });
    await result.callback.onFinal?.({ text: '', error: { message: 'rate limited' } } as never);
    await flush();
    expect(spans()).toHaveLength(2);
    for (const span of spans()) expect(span.attributes[A.OBSERVATION_LEVEL]).toBe('ERROR');
  });
});
