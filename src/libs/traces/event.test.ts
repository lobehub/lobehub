// @vitest-environment node
import { type LangfuseClient } from '@langfuse/client';
import { setLangfuseTracerProvider } from '@langfuse/tracing';
import { TraceEventType } from '@lobechat/types';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventScore, TraceEventClient } from './event';

vi.mock('diff', () => ({
  diffChars: vi.fn().mockReturnValue([{ added: true, count: 1, value: 'a' }]),
}));

const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
const observationId = '00f067aa0ba902b7';

const exporter = new InMemorySpanExporter();
setLangfuseTracerProvider(
  new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
);

const createClient = (id = traceId) => {
  const score = { create: vi.fn() };
  const client = new TraceEventClient({
    client: { score } as unknown as LangfuseClient,
    traceId: id,
  });

  return { client, score };
};

beforeEach(() => {
  exporter.reset();
});

describe('TraceEventClient', () => {
  it('records the event under the generation and scores it', () => {
    const { client, score } = createClient();

    client.copyMessage({ content: 'hello', observationId, traceId });

    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe(TraceEventType.CopyMessage);
    expect(span.spanContext().traceId).toBe(traceId);
    expect(span.parentSpanContext?.spanId).toBe(observationId);
    expect(span.attributes['langfuse.observation.type']).toBe('event');
    expect(span.attributes['langfuse.observation.input']).toBe('hello');
    expect(score.create).toHaveBeenCalledWith({
      name: 'copy message',
      observationId,
      traceId,
      value: EventScore.Copy,
    });
  });

  it('records the event in the trace without a score when the observation id is unknown', () => {
    const { client, score } = createClient();

    client.regenerateMessage({ content: 'hello', traceId } as any);

    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe(TraceEventType.RegenerateMessage);
    expect(span.spanContext().traceId).toBe(traceId);
    expect(score.create).not.toHaveBeenCalled();
  });

  it('only scores messages traced before the SDK v5 migration', () => {
    const legacyTraceId = '7d276f21-e777-4965-9c94-c91c2c07fbe4';
    const legacyObservationId = '62a399f3-6e86-4d8b-a62d-fd1a66138082';
    const { client, score } = createClient(legacyTraceId);

    client.deleteAndRegenerateMessage({
      content: 'hello',
      observationId: legacyObservationId,
      traceId: legacyTraceId,
    });

    expect(exporter.getFinishedSpans()).toHaveLength(0);
    expect(score.create).toHaveBeenCalledWith({
      name: 'delete and regenerate message',
      observationId: legacyObservationId,
      traceId: legacyTraceId,
      value: EventScore.DeleteAndRegenerate,
    });
  });

  it('records the edit with its diff', () => {
    const { client, score } = createClient();

    client.modifyMessage({ content: 'before', nextContent: 'after', observationId, traceId });

    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe(TraceEventType.ModifyMessage);
    expect(span.attributes['langfuse.observation.input']).toBe('before');
    expect(span.attributes['langfuse.observation.output']).toBe('after');
    expect(JSON.parse(span.attributes['langfuse.observation.metadata.diffs'] as string)).toEqual([
      { added: true, count: 1, value: 'a' },
    ]);
    expect(score.create).toHaveBeenCalledWith({
      name: 'modify message',
      observationId,
      traceId,
      value: EventScore.Modify,
    });
  });
});
