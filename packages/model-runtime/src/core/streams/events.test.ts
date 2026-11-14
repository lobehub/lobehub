import { describe, expect, it, vi } from 'vitest';

import type { ModelStreamEvent } from './events';
import {
  createEventCallbacksTransformer,
  createModelEventTransformer,
  createSSEEncoder,
} from './events';

const passThrough = (chunk: ModelStreamEvent) => chunk;

const readBytes = async (stream: ReadableStream<Uint8Array>) => {
  const decoder = new TextDecoder();
  const output: string[] = [];
  const reader = stream.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    output.push(decoder.decode(next.value));
  }
  return output;
};

const streamOf = (chunks: ModelStreamEvent[]) =>
  new ReadableStream<ModelStreamEvent>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

describe('model stream event pipeline', () => {
  it('encodes each event as id, event and data SSE lines', async () => {
    const output = await readBytes(
      streamOf([{ data: 'hello', id: '1', type: 'text' }])
        .pipeThrough(createModelEventTransformer(passThrough))
        .pipeThrough(createSSEEncoder()),
    );

    expect(output).toEqual(['id: 1\n', 'event: text\n', 'data: "hello"\n\n']);
  });

  it('does not add an error when a terminal event arrived', async () => {
    const output = await readBytes(
      streamOf([{ data: 'end_turn', id: 'ok', type: 'stop' }])
        .pipeThrough(
          createModelEventTransformer(passThrough, { id: 's' }, { requireTerminalEvent: true }),
        )
        .pipeThrough(createSSEEncoder()),
    );

    expect(output).toEqual(['id: ok\n', 'event: stop\n', 'data: "end_turn"\n\n']);
  });

  it('closes an interrupted stream with an error that callbacks also see', async () => {
    const onError = vi.fn();
    const onFinal = vi.fn();
    const data = {
      body: { name: 'Stream parsing error', reason: 'unexpected_end' },
      message: 'Stream ended unexpectedly',
      name: 'Stream parsing error',
      type: 'ProviderStreamInterrupted',
    };

    const output = await readBytes(
      streamOf([{ data: 'partial', id: '1', type: 'text' }])
        .pipeThrough(
          createModelEventTransformer(passThrough, { id: 's' }, { requireTerminalEvent: true }),
        )
        .pipeThrough(createEventCallbacksTransformer({ onError, onFinal }))
        .pipeThrough(createSSEEncoder()),
    );

    expect(output.slice(-3)).toEqual([
      'id: s\n',
      'event: error\n',
      `data: ${JSON.stringify(data)}\n\n`,
    ]);
    expect(onError).toHaveBeenCalledWith(data);
    expect(onFinal).toHaveBeenCalledWith(expect.objectContaining({ error: data, text: 'partial' }));
  });

  it('delivers payloads containing SSE markers intact', async () => {
    const onText = vi.fn();
    const text = 'event: x\ndata: y';

    const output = await readBytes(
      streamOf([{ data: text, id: '1', type: 'text' }])
        .pipeThrough(createEventCallbacksTransformer({ onText }))
        .pipeThrough(createSSEEncoder()),
    );

    expect(onText).toHaveBeenCalledWith(text);
    expect(output[2]).toBe(`data: ${JSON.stringify(text)}\n\n`);
  });

  it('forwards the event before a slow callback resolves', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const reader = streamOf([{ data: 'hi', id: '1', type: 'text' }])
      .pipeThrough(createEventCallbacksTransformer({ onText: () => pending }))
      .getReader();

    await expect(reader.read()).resolves.toMatchObject({
      value: { data: 'hi', type: 'text' },
    });

    release();
  });
});
