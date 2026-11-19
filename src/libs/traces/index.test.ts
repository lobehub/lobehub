// @vitest-environment node
import { createHash } from 'node:crypto';

import { getLangfuseTracer } from '@langfuse/tracing';
import { context, trace } from '@lobechat/observability-otel/api';
import type * as SdkTraceBase from '@opentelemetry/sdk-trace-base';
import type { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as server from '@/envs/langfuse';

import { TraceClient } from './index';

const { clientFlush, exporter, processorFlush } = vi.hoisted(() => ({
  clientFlush: vi.fn(),
  exporter: { current: undefined as InMemorySpanExporter | undefined },
  processorFlush: vi.fn(),
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

      override forceFlush() {
        processorFlush();
        return super.forceFlush();
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

let keyIndex = 0;

/** A fresh key set gives each test its own span processor and exporter. */
const enableLangfuse = () => {
  keyIndex += 1;
  vi.spyOn(server, 'getLangfuseConfig').mockReturnValue({
    ENABLE_LANGFUSE: true,
    LANGFUSE_HOST: 'https://cloud.langfuse.com',
    LANGFUSE_PUBLIC_KEY: `pk-lf-${keyIndex}`,
    LANGFUSE_SECRET_KEY: `sk-lf-${keyIndex}`,
  } as any);
};

const finishedSpans = () => exporter.current!.getFinishedSpans();

beforeEach(() => {
  vi.restoreAllMocks();
  clientFlush.mockReset();
  processorFlush.mockReset();
});

describe('TraceClient', () => {
  it('does nothing when ENABLE_LANGFUSE is false', async () => {
    vi.spyOn(server, 'getLangfuseConfig').mockReturnValue({ ENABLE_LANGFUSE: false } as any);

    const client = new TraceClient();

    expect(client.createTrace({ name: 'chat' })).toBeUndefined();
    expect(client.createEvent('a'.repeat(32))).toBeUndefined();
    await client.flush();
    expect(processorFlush).not.toHaveBeenCalled();
  });

  it('throws if LANGFUSE keys are missing', () => {
    vi.spyOn(server, 'getLangfuseConfig').mockReturnValue({ ENABLE_LANGFUSE: true } as any);

    expect(() => new TraceClient()).toThrow('NO_LANGFUSE_KEY_ERROR');
  });

  it('exports a root observation and a generation in one trace with the trace attributes', () => {
    enableLangfuse();
    const client = new TraceClient();

    const trace = client.createTrace({
      input: [{ content: 'hi', role: 'user' }],
      metadata: { provider: 'openai' },
      name: 'Conversation',
      sessionId: 'topic-1',
      tags: ['chat'],
      userId: 'user-1',
    })!;
    const generation = trace.generation('Chat Completion (openai)', { model: 'gpt-4o-mini' });
    trace.end();

    const spans = finishedSpans();
    expect(spans).toHaveLength(2);

    const root = spans.find((span) => span.name === 'Conversation')!;
    const child = spans.find((span) => span.name === 'Chat Completion (openai)')!;

    expect(trace.id).toMatch(/^[\da-f]{32}$/);
    expect(root.spanContext().traceId).toBe(trace.id);
    expect(child.spanContext().traceId).toBe(trace.id);
    expect(child.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    expect(child.spanContext().spanId).toBe(generation.id);

    expect(child.attributes['langfuse.observation.type']).toBe('generation');
    expect(child.attributes['langfuse.observation.model.name']).toBe('gpt-4o-mini');
    expect(JSON.parse(root.attributes['langfuse.observation.input'] as string)).toEqual([
      { content: 'hi', role: 'user' },
    ]);

    for (const span of [root, child]) {
      expect(span.attributes).toMatchObject({
        'langfuse.trace.name': 'Conversation',
        'langfuse.trace.tags': ['chat'],
        'session.id': 'topic-1',
        'user.id': 'user-1',
      });
    }
  });

  it('adds a request to the trace of an earlier request', () => {
    enableLangfuse();
    const client = new TraceClient();
    const earlier = 'b'.repeat(32);

    const trace = client.createTrace({ id: earlier, name: 'Conversation' })!;
    trace.end();

    expect(trace.id).toBe(earlier);
    expect(finishedSpans()[0].spanContext().traceId).toBe(earlier);
  });

  it('maps a legacy trace id to the trace id createTraceId(seed) would give', () => {
    enableLangfuse();
    const client = new TraceClient();
    const legacy = '7d276f21-e777-4965-9c94-c91c2c07fbe4';

    const trace = client.createTrace({ id: legacy })!;
    trace.end();

    expect(trace.id).toBe(createHash('sha256').update(legacy).digest('hex').slice(0, 32));
  });

  it('updates tags on observations that are still open', () => {
    enableLangfuse();
    const client = new TraceClient();

    const trace = client.createTrace({ name: 'Conversation', tags: ['chat'] })!;
    trace.generation('Chat Completion (openai)', {});
    trace.setTags(['chat', 'Tools Calling']);
    trace.end();

    for (const span of finishedSpans()) {
      expect(span.attributes['langfuse.trace.tags']).toEqual(['chat', 'Tools Calling']);
    }
  });

  it('ends each observation once', () => {
    enableLangfuse();
    const client = new TraceClient();

    const trace = client.createTrace({ name: 'Conversation' })!;
    trace.generation('Chat Completion (openai)', {}).end();
    trace.end();
    trace.end();

    expect(finishedSpans()).toHaveLength(2);
  });

  it('records observations under an unsampled incoming trace context', () => {
    enableLangfuse();
    new TraceClient();

    // The auth middleware runs each request inside the incoming trace context.
    const unsampled = trace.setSpanContext(context.active(), {
      spanId: 'd'.repeat(16),
      traceFlags: 0,
      traceId: 'c'.repeat(32),
    });
    const span = getLangfuseTracer().startSpan('probe', {}, unsampled);

    expect(span.isRecording()).toBe(true);
    span.end();
  });

  it('flushes spans and scores', async () => {
    enableLangfuse();
    const client = new TraceClient();

    await client.flush();

    expect(processorFlush).toHaveBeenCalledTimes(1);
    expect(clientFlush).toHaveBeenCalledTimes(1);
  });

  it('reuses one span processor per configuration', () => {
    enableLangfuse();
    new TraceClient().createTrace({ name: 'first' })!.end();
    const first = exporter.current;

    new TraceClient().createTrace({ name: 'second' })!.end();

    expect(exporter.current).toBe(first);
    expect(finishedSpans().map((span) => span.name)).toEqual(['first', 'second']);
  });
});
