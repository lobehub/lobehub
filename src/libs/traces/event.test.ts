// @vitest-environment node
import { LangfuseClient } from '@langfuse/client';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { LangfuseOtelSpanAttributes as A } from '@langfuse/tracing';
import { TraceEventType } from '@lobechat/types';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventScore, TraceEventClient } from './event';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [
    new LangfuseSpanProcessor({
      exporter,
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      mediaUploadEnabled: false,
    }),
  ],
});
const client = new LangfuseClient({ publicKey: 'pk-test', secretKey: 'sk-test' });
const score = vi.spyOn(client.score, 'create').mockImplementation(() => {});
const events = new TraceEventClient(client);
const base = {
  content: 'hello',
  observationId: '1234567890abcdef',
  traceId: '1234567890abcdef1234567890abcdef',
  sessionId: 'topic-1',
  userId: 'user-1',
};

beforeAll(() => {
  trace.setGlobalTracerProvider(provider);
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
});
beforeEach(() => {
  exporter.reset();
  score.mockClear();
});
afterAll(async () => {
  await provider.shutdown();
  context.disable();
  trace.disable();
});

describe('feedback observations', () => {
  it.each([
    ['copyMessage', TraceEventType.CopyMessage, 'copy message', EventScore.Copy],
    [
      'regenerateMessage',
      TraceEventType.RegenerateMessage,
      'regenerate message',
      EventScore.Regenerate,
    ],
    [
      'deleteAndRegenerateMessage',
      TraceEventType.DeleteAndRegenerateMessage,
      'delete and regenerate message',
      EventScore.DeleteAndRegenerate,
    ],
  ] as const)(
    'records and scores %s on the original generation',
    async (method, eventType, name, value) => {
      await events[method]({ ...base, eventType } as never);
      await provider.forceFlush();
      const [span] = exporter.getFinishedSpans();
      expect(span.name).toBe(eventType);
      expect(span.spanContext().traceId).toBe(base.traceId);
      expect(span.parentSpanContext?.spanId).toBe(base.observationId);
      expect(span.attributes).toMatchObject({
        [A.OBSERVATION_TYPE]: 'event',
        [A.OBSERVATION_INPUT]: 'hello',
        'user.id': base.userId,
        'session.id': base.sessionId,
      });
      expect(score).toHaveBeenCalledExactlyOnceWith({
        name,
        value,
        observationId: base.observationId,
        traceId: base.traceId,
      });
    },
  );

  it('records an edit as one immutable event with before/after content', async () => {
    await events.modifyMessage({
      ...base,
      eventType: TraceEventType.ModifyMessage,
      nextContent: 'edited',
    });
    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].attributes).toMatchObject({
      [A.OBSERVATION_INPUT]: 'hello',
      [A.OBSERVATION_OUTPUT]: 'edited',
    });
    expect(score).toHaveBeenCalledWith(expect.objectContaining({ value: EventScore.Modify }));
  });

  it('keeps legacy score targets while recording the legacy trace reference on a new event', async () => {
    await events.copyMessage({
      ...base,
      eventType: TraceEventType.CopyMessage,
      traceId: 'legacy-trace',
      observationId: 'legacy-observation',
    });
    await provider.forceFlush();
    expect(exporter.getFinishedSpans()[0].spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(exporter.getFinishedSpans()[0].attributes)).toContain('legacy-trace');
    expect(score).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: 'legacy-trace', observationId: 'legacy-observation' }),
    );
  });

  it('records events without inventing an observation score target', async () => {
    await events.copyMessage({
      ...base,
      eventType: TraceEventType.CopyMessage,
      observationId: undefined,
    });
    await provider.forceFlush();
    expect(exporter.getFinishedSpans()).toHaveLength(1);
    expect(score).not.toHaveBeenCalled();
  });
});
